import { getSettings } from "@/core/settings";
import { getEnv, hasMeterlessKey } from "@/lib/env";
import { probeMeterless } from "@/integrations/meterless/client";
import { getZetarisStatus } from "@/integrations/zetaris/client";
import { listAudit } from "@/core/warden/audit";

export const dynamic = "force-dynamic";

// Liveness/readiness split: this endpoint must answer even when the optional
// Nightshift provider is slow. The production Meterless budget is 60-90s, so
// an unbounded probe hangs health for over a minute. Bound the probe to a
// short health-specific timeout and degrade instead of hanging. Response
// shape is unchanged for the settings-page consumer.
const HEALTH_METERLESS_TIMEOUT_MS = 3_000;

export async function GET() {
  const env = getEnv();
  const settings = await getSettings();
  let meterless = {
    reachable: false,
    detail: "Health probe unavailable.",
    model: env.METERLESS_MODEL,
  };
  try {
    meterless = await probeMeterless(HEALTH_METERLESS_TIMEOUT_MS);
  } catch (error) {
    meterless = {
      reachable: false,
      detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      model: env.METERLESS_MODEL,
    };
  }
  let audit: Awaited<ReturnType<typeof listAudit>> = [];
  try {
    audit = await listAudit(8);
  } catch {
    audit = [];
  }
  return Response.json({
    ok: true,
    product: "VOW",
    mode: settings.mode,
    demoMode: !hasMeterlessKey() || !meterless.reachable || settings.demoModeForced,
    meterless: {
      configured: hasMeterlessKey(),
      baseUrl: env.METERLESS_BASE_URL,
      model: env.METERLESS_MODEL,
      reachable: meterless.reachable,
      detail: meterless.detail,
    },
    zetaris: getZetarisStatus(),
    recentAudit: audit,
  });
}
