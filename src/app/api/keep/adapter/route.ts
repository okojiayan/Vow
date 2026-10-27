import { currentAdapterName, getAdapter } from "@/core/keep/adapter";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ adapter: currentAdapterName(), available: ["mock", "nvidia"], note: "Set VOW_KEEP_ADAPTER to swap. Only the adapter changes." });
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const adapter = getAdapter(body.adapter ?? currentAdapterName());
    const out = await adapter.generate(body.messages ?? [{ role: "user", content: "hi" }], body.tools ?? []);
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
