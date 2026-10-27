import type {
  ProviderFallbackDiagnosis,
  ProviderFallbackReason,
  ProviderFallbackStage,
} from "@/core/traces/trace-types";
import type { MeterlessFailure } from "@/integrations/meterless/types";

const DETAIL_LIMIT = 240;

/** Failure metadata actually known at a catch/fallback boundary. Only the
 *  Meterless result code and HTTP status are consumed; the free-text error
 *  (which may embed a bounded response-body hint) is never copied. */
export interface MeterlessFailureInfo {
  code: MeterlessFailure["code"];
  httpStatus?: number;
}

function boundDetail(text: string): string {
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
}

/** Map a Meterless failure to a controlled reason category using only
 *  structured fields. `responded` is true only when the provider returned
 *  an HTTP response (error status or unusable 200 body). */
export function reasonForMeterlessFailure(info: MeterlessFailureInfo): {
  reason: ProviderFallbackReason;
  responded: boolean;
} {
  if (info.code === "timeout") return { reason: "timeout", responded: false };
  if (info.code === "not_configured") return { reason: "not_configured", responded: false };
  if (info.code === "invalid_response") {
    if (typeof info.httpStatus === "number") return { reason: "http_error", responded: true };
    return { reason: "empty_response", responded: true };
  }
  // "unavailable": HTTP 5xx (responded) or network-level failure (not).
  if (typeof info.httpStatus === "number") return { reason: "http_error", responded: true };
  return { reason: "network_error", responded: false };
}

function describeFailure(
  stage: ProviderFallbackStage,
  reason: ProviderFallbackReason,
  opts: { elapsedMs?: number; httpStatus?: number; modelExpected?: string },
): string {
  const where = stage === "planner" ? "Planner model call" : "Investigation model call";
  const model = opts.modelExpected ? ` (model ${opts.modelExpected})` : "";
  switch (reason) {
    case "timeout":
      return typeof opts.elapsedMs === "number"
        ? `${where} timed out after ${opts.elapsedMs}ms${model}; heuristic fallback selected.`
        : `${where} timed out${model}; heuristic fallback selected.`;
    case "http_error":
      return typeof opts.httpStatus === "number"
        ? `${where} failed with HTTP ${opts.httpStatus}${model}; heuristic fallback selected.`
        : `${where} failed with an HTTP error${model}; heuristic fallback selected.`;
    case "network_error":
      return `${where} failed before a provider response${model}; heuristic fallback selected.`;
    case "empty_response":
      return `${where} returned no usable text${model}; heuristic fallback selected.`;
    case "parse_error":
      return `${where} response failed validation${model}; heuristic fallback selected.`;
    case "not_configured":
      return `Provider not configured for ${stage}${model}; heuristic route selected without a provider attempt.`;
    default:
      return `${where} fell back without recorded cause${model}.`;
  }
}

/** Build a structured diagnosis for a failed Meterless call. Reads only
 *  `code`/`httpStatus`; never copies raw error text, bodies, prompts, or
 *  credentials. */
export function diagnoseMeterlessFailure(
  failure: MeterlessFailureInfo,
  stage: ProviderFallbackStage,
  opts: { elapsedMs?: number; modelExpected?: string } = {},
): ProviderFallbackDiagnosis {
  const { reason, responded } = reasonForMeterlessFailure(failure);
  const diagnosis: ProviderFallbackDiagnosis = {
    stage,
    reason,
    responded,
    detail: boundDetail(
      describeFailure(stage, reason, { elapsedMs: opts.elapsedMs, httpStatus: failure.httpStatus, modelExpected: opts.modelExpected }),
    ),
  };
  if (typeof opts.elapsedMs === "number" && Number.isFinite(opts.elapsedMs)) {
    diagnosis.elapsedMs = Math.max(0, Math.floor(opts.elapsedMs));
  }
  if (typeof failure.httpStatus === "number") {
    diagnosis.httpStatus = failure.httpStatus;
  }
  diagnosis.code = failure.code;
  if (opts.modelExpected) {
    diagnosis.modelExpected = opts.modelExpected;
  }
  return diagnosis;
}

/** Diagnosis for a planner-selected heuristic route after a successful
 *  provider call (e.g. an intent guard overriding a live-model plan).
 *  Explicitly not a provider failure. */
export function deliberateHeuristicDiagnosis(
  stage: ProviderFallbackStage,
  note: string,
  opts: { elapsedMs?: number; modelExpected?: string } = {},
): ProviderFallbackDiagnosis {
  const diagnosis: ProviderFallbackDiagnosis = {
    stage,
    reason: "deliberate_heuristic_route",
    responded: true,
    detail: boundDetail(`Planner selected a heuristic route (${note}); no provider failure occurred.`),
  };
  if (typeof opts.elapsedMs === "number" && Number.isFinite(opts.elapsedMs)) {
    diagnosis.elapsedMs = Math.max(0, Math.floor(opts.elapsedMs));
  }
  if (opts.modelExpected) {
    diagnosis.modelExpected = opts.modelExpected;
  }
  return diagnosis;
}

/** Safe diagnosis when a heuristic fallback carries no failure metadata
 *  (e.g. a foreign model port that reports heuristic provenance without a
 *  cause). Recorded as `unknown`, never as success. */
export function unknownFallbackDiagnosis(stage: ProviderFallbackStage): ProviderFallbackDiagnosis {
  return {
    stage,
    reason: "unknown",
    responded: false,
    detail: `${stage === "planner" ? "Planner" : "Investigation"} fell back to heuristic without recorded cause.`,
  };
}
