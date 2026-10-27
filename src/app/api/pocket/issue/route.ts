import { issuePocketToken } from "@/core/remote/pocket";
import { checkTickAccess } from "@/core/agent/worker-guard";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Local-only: issuing requires the worker-token bearer when configured.
export async function POST(request: Request) {
  const env = getEnv();
  const access = checkTickAccess({
    authorizationHeader: request.headers.get("authorization"),
    workerToken: env.VOW_WORKER_TOKEN ?? "",
    rateLimitPerMinute: env.VOW_WORKER_TICK_PER_MINUTE ?? 20,
  });
  // When no worker token is configured, local calls are allowed (rate-limited).
  if (!access.authorized && (env.VOW_WORKER_TOKEN ?? "").trim()) {
    return Response.json({ error: access.reason }, { status: access.status });
  }
  try {
    const body = (await request.json()) as { parkedId?: string; planVersion?: string };
    if (!body.parkedId || !body.planVersion) return Response.json({ error: "parkedId and planVersion are required." }, { status: 400 });
    const { raw, record } = await issuePocketToken({ parkedId: body.parkedId, planVersion: body.planVersion });
    const { tokenHash: _unused, ...safe } = record as unknown as Record<string, unknown>;
    void _unused;
    return Response.json({ token: raw, record: safe, transport: "local-only; no phone delivery configured" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
