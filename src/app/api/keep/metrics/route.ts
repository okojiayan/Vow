export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ tokens_note: "See results/recall_bench.json and results/cost_check.json for measured tokens/latency.", honest: "limits the damage and blocks known tricks" });
}
