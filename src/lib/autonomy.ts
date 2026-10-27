// Maps the four user-facing autonomy modes to the backend Warden operating mode.
// The Warden gateway stays enforced in every mode; "Warden" selects the same
// autonomous backend policy with the signature transformation, purple identity,
// and evidence-first surfacing. This mapping is deliberately explicit so the UI
// never implies a mode the policy layer does not implement.

export type UiAutonomyMode = "manual" | "smart" | "full" | "warden";
export type BackendMode = "supervised" | "assisted" | "autonomous";

export interface AutonomyOption {
  id: UiAutonomyMode;
  label: string;
  hint: string;
  description: string;
  backend: BackendMode;
}

export const AUTONOMY_OPTIONS: AutonomyOption[] = [
  {
    id: "manual",
    label: "Supervised",
    hint: "Ask before consequential actions.",
    description: "Warden requests approval before consequential actions. Nothing executes without your say-so.",
    backend: "supervised",
  },
  {
    id: "smart",
    label: "Smart use",
    hint: "Handle routine work; ask when scope expands.",
    description: "Routine, in-scope work flows through. Warden pauses for approval when scope expands or risk rises.",
    backend: "assisted",
  },
  {
    id: "full",
    label: "Turbo",
    hint: "Act independently — review risks first.",
    description: "Turbo runs independently. Review the risks before using it on important files. Policy boundaries and denials still apply.",
    backend: "autonomous",
  },
  {
    id: "warden",
    label: "Warden",
    hint: "Strict enforcement, evidence, and verification.",
    description: "Same always-on Warden gateway with evidence-first surfacing and independent verification emphasis.",
    backend: "autonomous",
  },
];

export function optionFor(mode: UiAutonomyMode): AutonomyOption {
  return AUTONOMY_OPTIONS.find((o) => o.id === mode) ?? AUTONOMY_OPTIONS[1];
}

export function backendModeFor(mode: UiAutonomyMode): BackendMode {
  return optionFor(mode).backend;
}

export function isWardenUiMode(mode: UiAutonomyMode): boolean {
  return mode === "warden";
}

export function uiModeForBackend(backend: string, warden: boolean): UiAutonomyMode {
  if (warden) return "warden";
  if (backend === "supervised") return "manual";
  if (backend === "assisted") return "smart";
  return "full";
}
