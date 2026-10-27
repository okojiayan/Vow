import { getSettings, updateSettings } from "@/core/settings";
import { listApprovals } from "@/core/warden/approval-service";
import { listAudit } from "@/core/warden/audit";
import { TOOL_PERMISSIONS } from "@/core/warden/policy";
import { wardenModeSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  const approvals = await listApprovals();
  const audit = await listAudit(30);
  return Response.json({
    mode: settings.mode,
    gatewayAlwaysOn: true,
    permissions: TOOL_PERMISSIONS,
    pendingApprovals: approvals.filter((item) => item.status === "pending"),
    approvals,
    audit,
  });
}

export async function POST(request: Request) {
  try {
    const body = wardenModeSchema.parse(await request.json());
    const before = await getSettings();
    const settings = await updateSettings({ mode: body.mode });
    try {
      const { recordAudit } = await import("@/core/warden/audit");
      if (before.mode !== settings.mode) {
        await recordAudit({ kind: "policy", taskId: "settings", tool: "mode.set", decision: settings.mode, policy: "mode.change", reason: `Autonomy pre-authorization changed ${before.mode} → ${settings.mode}. Warden gateway stays enforced; mode never overrides denial.`, outcome: "success" });
      }
    } catch { /* audit best-effort */ }
    return Response.json({
      mode: settings.mode,
      gatewayAlwaysOn: true,
      note: "Mode changes pre-authorization only. The Warden gateway cannot be bypassed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
