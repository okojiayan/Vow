import { collectDeadlines, dismissDeadline } from "@/core/time/deadlines";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ deadlines: await collectDeadlines(), readOnly: true });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { dismiss?: string };
    if (!body.dismiss) return Response.json({ error: "dismiss id is required." }, { status: 400 });
    await dismissDeadline(body.dismiss);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
