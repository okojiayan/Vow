import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import type { ExecutionTrace, TraceEvent, TraceEventKind } from "./trace-types";

const STORE = () => dataPath("traces.json");

type TraceMap = Record<string, ExecutionTrace>;

export async function appendTrace(
  taskId: string,
  event: { kind: TraceEventKind; title: string; detail: string; data?: unknown },
): Promise<TraceEvent> {
  const full: TraceEvent = {
    id: createId("tr"),
    taskId,
    createdAt: new Date().toISOString(),
    ...event,
  };
  await mutateJsonFile<TraceMap>(STORE(), {}, (current) => {
    const existing = current[taskId] ?? { taskId, events: [] };
    return {
      ...current,
      [taskId]: { taskId, events: [...existing.events, full] },
    };
  });
  return full;
}

export async function getTrace(taskId: string): Promise<ExecutionTrace> {
  const all = await readJsonFile<TraceMap>(STORE(), {});
  return all[taskId] ?? { taskId, events: [] };
}

export async function listTraces(): Promise<ExecutionTrace[]> {
  const all = await readJsonFile<TraceMap>(STORE(), {});
  return Object.values(all).sort((a, b) => {
    const aTs = a.events.at(-1)?.createdAt ?? "";
    const bTs = b.events.at(-1)?.createdAt ?? "";
    return bTs.localeCompare(aTs);
  });
}
