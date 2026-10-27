import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import type { AgentTask, Conversation } from "./types";

const TASKS = () => dataPath("tasks.json");
const CONVOS = () => dataPath("conversations.json");

function normalizeTask(task: Partial<AgentTask>): AgentTask {
  return Object.assign({
    autonomyMode: null,
    queuedAt: null,
    claimedAt: null,
    claimedBy: null,
    cancelRequested: false,
    cancelReason: null,
    attempts: 0,
    parentTaskId: null,
    allowedTools: null,
    lastHeartbeat: null,
    ...task});
}

export async function listTasks(): Promise<AgentTask[]> {
  const tasks = await readJsonFile<AgentTask[]>(TASKS(), []);
  return tasks.map(normalizeTask).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getTask(id: string): Promise<AgentTask | undefined> {
  const tasks = await listTasks();
  return tasks.find((task) => task.id === id);
}

export async function saveTask(input: AgentTask): Promise<AgentTask> {
  const task = normalizeTask(input);
  await mutateJsonFile<AgentTask[]>(TASKS(), [], (current) => {
    const index = current.findIndex((item) => item.id === task.id);
    if (index === -1) return [task, ...current];
    const next = [...current];
    next[index] = task;
    return next;
  });
  return task;
}

export async function listConversations(): Promise<Conversation[]> {
  return readJsonFile<Conversation[]>(CONVOS(), []);
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const all = await listConversations();
  return all.find((item) => item.id === id);
}

export async function saveConversation(conversation: Conversation): Promise<Conversation> {
  await mutateJsonFile<Conversation[]>(CONVOS(), [], (current) => {
    const index = current.findIndex((item) => item.id === conversation.id);
    if (index === -1) return [conversation, ...current];
    const next = [...current];
    next[index] = conversation;
    return next;
  });
  return conversation;
}
