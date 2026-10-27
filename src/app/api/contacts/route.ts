import { addContact, listContacts, revokeContact, buildAwayReport, canContactApprove } from "@/core/remote/contacts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reportTask = url.searchParams.get("reportTask");
  const contactId = url.searchParams.get("contactId");
  if (reportTask && contactId) {
    try {
      return Response.json({ report: await buildAwayReport(reportTask, contactId) });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  const checkParked = url.searchParams.get("checkParked");
  if (checkParked && contactId) {
    return Response.json(await canContactApprove(contactId, checkParked));
  }
  return Response.json({ contacts: await listContacts() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { label?: string; purposes?: ("view_report" | "approve_delegated")[]; delegatedActions?: string[] };
    const c = await addContact({ label: body.label ?? "", purposes: body.purposes ?? [], delegatedActions: body.delegatedActions });
    return Response.json({ contact: c });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });
  return Response.json({ contact: await revokeContact(id) });
}
