import { collectSecurityEvents, communityFeed } from "@/core/safety/tricks";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tasks = url.searchParams.get("tasks")?.split(",").filter(Boolean);
  const events = await collectSecurityEvents();
  const personal = tasks ? events.filter((e) => e.taskId && tasks.includes(e.taskId)) : events;
  return Response.json({ personal, community: communityFeed() });
}
