import { getConversation, listConversations } from "@/core/agent/task-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (id) {
    const conversation = await getConversation(id);
    if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });
    return Response.json({ conversation });
  }
  const conversations = await listConversations();
  return Response.json({ conversations });
}
