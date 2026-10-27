import { notFound } from "next/navigation";
import { WardenStageHarness } from "./harness";

export const metadata = { title: "Warden stage test — VOW" };

// Dev-only harness for tools/audit/warden-lifecycle.mjs. Never linked in
// the app nav; compiled out of production so it cannot leak into the UI.
export default function WardenStagePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <WardenStageHarness />;
}
