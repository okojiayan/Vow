import { randomUUID } from "node:crypto";

export function createId(prefix = "vow"): string {
  return `${prefix}_${randomUUID()}`;
}
