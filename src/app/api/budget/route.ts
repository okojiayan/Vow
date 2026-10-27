import { createBudget, listBudgets, getBudget, revokeBudget, tryConsumeBudget } from "@/core/remote/budget";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) return Response.json({ budget: await getBudget(id) });
  return Response.json({ budgets: await listBudgets() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { maxUnits?: number; scope?: string; consume?: { budgetId: string; tool: string; taskId: string } };
    if (body.consume) {
      return Response.json(await tryConsumeBudget({ budgetId: body.consume.budgetId, tool: body.consume.tool, taskId: body.consume.taskId }));
    }
    const b = await createBudget({ maxUnits: body.maxUnits ?? 10, scope: body.scope });
    return Response.json({ budget: b });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });
  await revokeBudget(id);
  return Response.json({ ok: true });
}
