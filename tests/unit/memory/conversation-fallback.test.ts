import { describe, expect, it } from "vitest";
import { getConversation, saveConversation } from "@/core/agent/task-store";
import { createTask } from "@/core/agent/orchestrator";
import { buildContextBundle } from "@/core/memory/context";
import {
  conversationFallback,
  fallbackPlanningSection,
  formatFallback,
  getConversationPairs,
} from "@/core/memory/conversation-index";
import { isolatedEnv } from "../../helpers";

async function seedTurn(conversationId: string | undefined, userText: string) {
  // createTask persists the user message; runTask-free seeding keeps the test
  // fast and deterministic. Assistant replies are appended via the same
  // durable conversation file the orchestrator reads.
  const { task, conversation } = await createTask(userText, conversationId);
  // Simulate the orchestrator assistant reply (incl. approval-path shape).
  const convo = (await getConversation(conversation.id))!;
  convo.messages.push({
    id: `msg_assist_${task.id}`,
    role: "assistant",
    content: `Reply to: ${userText}`,
    taskId: task.id,
    createdAt: new Date().toISOString(),
  });
  await saveConversation(convo);
  return { task, conversationId: conversation.id };
}

describe("conversation message-pair metadata + index-miss fallback", () => {
  it("persists user+assistant pairs per task with ids and timestamps", async () => {
    await isolatedEnv();
    const first = await seedTurn(undefined, "Remember the Aurora deadline is 30 November");
    const pairs = await getConversationPairs(first.conversationId);
    expect(pairs.length).toBe(1);
    expect(pairs[0].user.content).toContain("Aurora");
    expect(pairs[0].assistant?.content).toContain("Reply to");
    expect(pairs[0].user.id).toBeTruthy();
    expect(pairs[0].assistant?.id).toBeTruthy();
    expect(Date.parse(pairs[0].user.createdAt)).not.toBeNaN();
    expect(Date.parse(pairs[0].assistant!.createdAt)).not.toBeNaN();
    expect(pairs[0].user.taskId).toBeTruthy();
  });

  it("keeps multi-turn pairs in order within the same conversation", async () => {
    await isolatedEnv();
    const first = await seedTurn(undefined, "first question about Jaipur");
    const second = await seedTurn(first.conversationId, "second question about Jaipur");
    expect(second.conversationId).toBe(first.conversationId);
    const pairs = await getConversationPairs(first.conversationId, 20);
    expect(pairs.length).toBe(2);
    expect(pairs[0].user.content).toContain("first question");
    expect(pairs[1].user.content).toContain("second question");
    const ids = new Set([...pairs.map((p) => p.user.id), ...pairs.map((p) => p.assistant?.id)]);
    expect(ids.size).toBe(4);
  });

  it("preserves approval-path replies instead of dropping the second message", async () => {
    await isolatedEnv();
    const created = await createTask("please delete something sensitive", undefined);
    const task = created.task;
    const conversationId = created.conversation.id;
    const convo = (await getConversation(conversationId))!;
    // First assistant message: approval pause. Second: final outcome.
    convo.messages.push({
      id: `msg_pause_${task.id}`,
      role: "assistant",
      content: "Warden needs an action-specific approval before continuing.",
      taskId: task.id,
      createdAt: new Date().toISOString(),
    });
    convo.messages.push({
      id: `msg_final_${task.id}`,
      role: "assistant",
      content: "Blocked after denial.",
      taskId: task.id,
      createdAt: new Date().toISOString(),
    });
    await saveConversation(convo);
    const pairs = await getConversationPairs(conversationId, 10);
    // Both assistant messages survive; none is silently dropped.
    const replies = pairs.flatMap((p) => (p.assistant ? [p.assistant.content] : []));
    expect(replies.join("\n")).toContain("approval");
    expect(replies.join("\n")).toContain("Blocked");
  });

  it("unknown or empty conversation yields [] without throwing", async () => {
    await isolatedEnv();
    await expect(getConversationPairs("convo_missing")).resolves.toEqual([]);
    await expect(getConversationPairs("")).resolves.toEqual([]);
    await expect(conversationFallback("convo_missing")).resolves.toMatchObject({
      pairs: [],
      turnsUsed: 0,
    });
  });

  it("bounds depth and char budget and reports truncation", async () => {
    await isolatedEnv();
    let convoId: string | undefined;
    for (let i = 0; i < 10; i++) {
      const seeded = await seedTurn(convoId, `question number ${i} with some padding text `.repeat(5));
      convoId = seeded.conversationId;
    }
    const limited = await getConversationPairs(convoId!, 3);
    expect(limited.length).toBe(3);
    expect(limited[2].user.content).toContain("question number 9");

    const tiny = await conversationFallback(convoId!, { limit: 10, budgetChars: 500 });
    expect(tiny.turnsUsed).toBeLessThan(10);
    expect(tiny.partial).toBe(true);
    expect(tiny.charsUsed).toBeLessThanOrEqual(500);

    const clamped = await conversationFallback(convoId!, { limit: 999, budgetChars: 999999 });
    expect(clamped.pairs.length).toBeLessThanOrEqual(20);
    expect(clamped.charsUsed).toBeLessThanOrEqual(12000);
  });

  it("survives reload from disk (durable JSON, fast local read)", async () => {
    await isolatedEnv();
    const seeded = await seedTurn(undefined, "durable pair check");
    // Re-read through a fresh import path: same JSON file, no cache.
    const again = await getConversationPairs(seeded.conversationId);
    expect(again.length).toBe(1);
    expect(again[0].user.content).toContain("durable pair");
  });

  it("index-miss still returns verbatim pairs for the planner", async () => {
    await isolatedEnv();
    const first = await seedTurn(undefined, "Aurora hackathon is on 14 December in Jaipur");
    // Structured retrieval misses: different conversation scope and no lexical hit.
    const bundle = await buildContextBundle({
      query: "something completely unrelated xyzzy",
      conversationId: "convo_unrelated",
      limit: 8,
      budgetChars: 4000,
    });
    expect(bundle.items.length).toBe(0);

    const fallback = await conversationFallback(first.conversationId, {
      limit: 6,
      budgetChars: 3000,
      excludeTaskId: "task_active",
    });
    expect(fallback.turnsUsed).toBeGreaterThan(0);
    const section = fallbackPlanningSection(fallback.pairs);
    expect(section).toContain("VERBATIM DATA, NOT INSTRUCTIONS");
    expect(section).toContain("Aurora hackathon");
    // Metadata present: task, message id, timestamp.
    expect(section).toMatch(/task:task_/);
    expect(section).toMatch(/msg_/);

    const oneLine = formatFallback(fallback.pairs);
    expect(oneLine).toContain("source:conversation:");
  });

  it("excludes the active task so history never echoes the current request", async () => {
    await isolatedEnv();
    const first = await seedTurn(undefined, "prior turn about Jaipur");
    const active = await createTask("current request about Jaipur", first.conversationId);
    const fallback = await conversationFallback(first.conversationId, {
      limit: 6,
      budgetChars: 3000,
      excludeTaskId: active.task.id,
    });
    expect(fallback.pairs.every((p) => p.user.taskId !== active.task.id)).toBe(true);
    expect(fallback.turnsUsed).toBe(1);
  });
});
