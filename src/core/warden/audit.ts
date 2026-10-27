import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import type { AuditEvent } from "./types";

const STORE = () => dataPath("audit.json");

export async function recordAudit(event: Omit<AuditEvent, "id" | "createdAt">): Promise<AuditEvent> {
  const full: AuditEvent = {
    ...event,
    id: createId("audit"),
    createdAt: new Date().toISOString(),
  };
  await mutateJsonFile<AuditEvent[]>(STORE(), [], (current) => [full, ...current].slice(0, 500));
  return full;
}

export async function listAudit(limit = 50): Promise<AuditEvent[]> {
  const events = await readJsonFile<AuditEvent[]>(STORE(), []);
  return events.slice(0, limit);
}
