export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string | null };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface MeterlessSuccess {
  ok: true;
  text: string;
  model: string;
  usage?: ChatCompletionResponse["usage"];
  raw: ChatCompletionResponse;
}

export interface MeterlessFailure {
  ok: false;
  error: string;
  code: "not_configured" | "unavailable" | "invalid_response" | "timeout";
  /** HTTP status when the provider responded with an error status. Absent
   *  for timeouts, network failures, and empty-200 responses. */
  httpStatus?: number;
}

export type MeterlessResult = MeterlessSuccess | MeterlessFailure;
