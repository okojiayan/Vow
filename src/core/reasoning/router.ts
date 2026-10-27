import type { EffortLevel } from "./effort";
import { clampToCeiling } from "./effort";

export type ReasoningRoute = "quick" | "deep";

export interface RouteInput {
  message: string;
  effortCeiling: EffortLevel;
  userChoice?: "quick" | "deep";
  deterministic?: boolean;
}

export interface RouteDecision {
  route: ReasoningRoute;
  reason: string;
  modelCalls: number;
  deterministic: boolean;
}

const DEEP_HINTS = [
  /\b(step\s?\d|first[,.]?\s+then|and\s+then|after\s+that)\b/i,
  /\b(compare|trade-?offs?|pros\s+and\s+cons|design|architect|roadmap|research|investigat)\w*\b/i,
  /\b(delete|pay|send|cancel|publish|deploy|merge|overwrite)\b/i,
  /\b(http|fetch|browse|search\s+the\s+web|external)\b/i,
  /\b(if|whether|depends|ambiguous|maybe|uncertain)\b/i,
];

/**
 * Truthful routing: explicit task characteristics + effort budget only.
 * Never inspects the final response tone or length. Deterministic fast
 * paths always stay quick with zero model calls.
 */
export function routeRequest(input: RouteInput): RouteDecision {
  try {
    if (input.deterministic) {
      return { route: "quick", reason: "Deterministic fast path matched; no model inference needed.", modelCalls: 0, deterministic: true };
    }
    if (input.userChoice === "quick" || input.userChoice === "deep") {
      const route = input.userChoice;
      return {
        route,
        reason: `User explicitly chose ${route === "quick" ? "a quick answer" : "deep reasoning"}.`,
        modelCalls: route === "quick" ? 1 : 2,
        deterministic: false,
      };
    }
    const text = input.message.trim();
    if (text.length <= 140 && !DEEP_HINTS.some((re) => re.test(text))) {
      return { route: "quick", reason: "Short single-step request within the effort ceiling; lightweight reasoning suffices.", modelCalls: 1, deterministic: false };
    }
    const consequential = /\b(delete|pay|send|cancel|publish|deploy|merge|overwrite)\b/i.test(text) || /\b(http|fetch|browse|search\s+the\s+web|external)\b/i.test(text);
    if (input.effortCeiling === "Light" && !consequential) {
      return { route: "quick", reason: "Light effort ceiling: staying with lightweight reasoning.", modelCalls: 1, deterministic: false };
    }
    const matched = DEEP_HINTS.filter((re) => re.test(text)).length;
    if (matched > 0) {
      const capped = clampToCeiling("High", input.effortCeiling);
      return { route: "deep", reason: `Task signals deeper work (${matched} indicator${matched === 1 ? "" : "s"}: multi-step, consequential, external, or ambiguous); effort capped at ${capped}.`, modelCalls: 2, deterministic: false };
    }
    return { route: input.effortCeiling === "Light" ? "quick" : "deep", reason: input.effortCeiling === "Light" ? "Light effort ceiling: staying with lightweight reasoning." : "No quick-path criteria matched; using full reasoning within budget.", modelCalls: input.effortCeiling === "Light" ? 1 : 2, deterministic: false };
  } catch {
    return { route: "deep", reason: "Routing failed; defaulting to full reasoning rather than mislabeling.", modelCalls: 2, deterministic: false };
  }
}

/** UI label derived from routing + execution metadata only. */
export function routeLabel(input: { route: ReasoningRoute; inferenceMode: string; deterministic: boolean }): "Quick answer" | "Thought deeply" {
  if (input.deterministic || input.inferenceMode === "deterministic") return "Quick answer";
  if (input.route === "deep" && input.inferenceMode === "live-model") return "Thought deeply";
  return "Quick answer";
}
