import { listTasks } from "@/core/agent/task-store";
import { isWorkerRunning } from "@/core/agent/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  const tasks = await listTasks();
  return Response.json({
    workerRunning: isWorkerRunning(),
    queued: tasks.filter((t) => t.status === "queued").length,
    claimed: tasks.filter((t) => t.status === "claimed").length,
    executing: tasks.filter((t) => t.status === "executing").length,
    awaiting_approval: tasks.filter((t) => t.status === "awaiting_approval").length,
    interrupted: tasks.filter((t) => t.status === "interrupted").length,
    cancelled: tasks.filter((t) => t.status === "cancelled").length,
    total: tasks.length,
    note: "Local worker runs in-process. Closing the tab keeps queued work; stopping the server or sleeping the machine pauses it.",
  });
}
