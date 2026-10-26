import { redirect } from "next/navigation";

export default function LegacyConnectorRedirect() {
  redirect("/tools");
}
