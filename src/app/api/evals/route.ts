import { latestReport, runEvaluation } from "@/core/rcf/evaluator";
import { evalRunSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await latestReport();
  return Response.json({ report });
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-length") !== "0") {
      evalRunSchema.parse(await request.json().catch(() => ({})));
    }
    const report = await runEvaluation();
    return Response.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
