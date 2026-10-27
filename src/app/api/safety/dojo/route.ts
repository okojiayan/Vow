import { DOJO_SCENARIOS } from "@/core/safety/tricks";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ synthetic: true, scenarios: DOJO_SCENARIOS, note: "All scenarios are synthetic teaching examples. None of them happened on your system." });
}
