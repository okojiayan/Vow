import { describe, expect, it } from "vitest";
import { DELETE, GET, PATCH } from "@/app/api/memory/[id]/route";
import { submitCandidate } from "@/core/memory/lifecycle";
import { isolatedEnv } from "../../helpers";

describe("memory [id] route handlers", () => {
  it("GET/PATCH/DELETE round-trip", async () => {
    await isolatedEnv();
    const created = await submitCandidate({
      content: "Route probe memory.",
      kind: "semantic",
      source: { type: "user", ref: "t" },
      provenance: "user-explicit:t",
      explicit: true,
    });
    expect(created.stored).toBe(true);
    if (!created.stored) return;
    const id = created.record.id;
    const req = (method: string, body?: unknown) =>
      new Request(`http://localhost/api/memory/${id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    const ctx = { params: Promise.resolve({ id }) };
    const got = await GET(req("GET"), ctx);
    expect(got.status).toBe(200);
    const patched = await PATCH(req("PATCH", { action: "pin" }), ctx);
    expect(patched.status).toBe(200);
    const deleted = await DELETE(req("DELETE"), ctx);
    expect(deleted.status).toBe(200);
  });
});
