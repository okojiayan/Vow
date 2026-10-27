import { runSwapComparison, confirmModelSwitch } from "@/core/models/swap-guard";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      candidates?: string[];
      cases?: Array<{ id: string; prompt: string; expectJson?: boolean }>;
      confirm?: { candidate: string; confirmed: boolean; fallback: string };
    };
    if (body.confirm) return Response.json(await confirmModelSwitch(body.confirm));
    const report = await runSwapComparison({ candidates: body.candidates ?? [], cases: body.cases ?? [] });
    return Response.json({ report });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
