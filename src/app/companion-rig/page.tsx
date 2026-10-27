import { notFound } from "next/navigation";
import { Companion } from "@/components/vow/Companion";

export const metadata = { title: "Companion rig test — VOW" };

// Dev-only harness for tools/audit/companion-face-rig.mjs (?variant=warden
// previews the armored variant). Never linked in the app nav; compiled out
// of production so it cannot leak into the UI.
export default async function CompanionRigPage({
  searchParams,
}: {
  searchParams?: Promise<{ variant?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const variant = (await searchParams)?.variant === "warden" ? "warden" : "normal";
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--ds-bg, #efe9e1)",
      }}
    >
      <Companion
        variant={variant}
        liveliness="live"
        interactive
        state="idle"
        className="companion-hero"
        label="Poke the mascot"
      />
    </main>
  );
}
