import { completeChat as meterlessComplete } from "@/integrations/meterless/client";
import type { ChatMessage } from "@/integrations/meterless/types";

export interface KeepGenerateOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface KeepToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface KeepGenerateResult {
  text: string;
  tool_calls: KeepToolCall[];
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  adapter: string;
  model: string;
}

export interface KeepAdapter {
  name: string;
  generate(messages: ChatMessage[], tools: string[], options?: KeepGenerateOptions): Promise<KeepGenerateResult>;
}

function countTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class MockAdapter implements KeepAdapter {
  name = "mock";
  async generate(messages: ChatMessage[], _tools: string[], options?: KeepGenerateOptions): Promise<KeepGenerateResult> {
    const started = Date.now();
    const last = messages.at(-1)?.content ?? "";
    const text = `MOCK-REPLY :: ${String(last).slice(0, 220)}`;
    return {
      text,
      tool_calls: [],
      usage: { input_tokens: countTokens(messages.map((m) => m.content).join("\n")), output_tokens: countTokens(text) },
      latency_ms: Date.now() - started,
      adapter: "mock",
      model: options?.model ?? "mock-1",
    };
  }
}

async function postJson(url: string, key: string, body: unknown, timeoutMs: number): Promise<{ text: string; model: string; input: number; output: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${b ? `: ${b.slice(0, 200)}` : ""}`);
    }
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }>; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; text?: unknown; model?: unknown; modelId?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number }; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    const rawText: unknown =
      (typeof payload.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content : undefined) ??
      payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      (typeof payload.text === "string" ? payload.text : undefined);
    if (!rawText || (typeof rawText === "string" && !rawText.trim())) throw new Error("Empty completion text");
    const text = String(rawText);
    const model = typeof payload.model === "string" ? payload.model : typeof payload.modelId === "string" ? payload.modelId : "unknown";
    return { text, model, input: payload.usage?.prompt_tokens ?? 0, output: payload.usage?.completion_tokens ?? 0 };
  } finally {
    clearTimeout(t);
  }
}

export class NvidiaAdapter implements KeepAdapter {
  name = "nvidia";
  async generate(messages: ChatMessage[], _tools: string[], options?: KeepGenerateOptions): Promise<KeepGenerateResult> {
    const key = (process.env.METERLESS_API_KEY ?? "").trim();
    if (!key) throw new Error("Missing adapter: set METERLESS_API_KEY for the NVIDIA adapter.");
    const started = Date.now();
    const result = await meterlessComplete(messages.map((m) => ({ role: m.role, content: m.content })));
    if (!result.ok) throw new Error(`NVIDIA adapter failed (${result.code}): ${result.error}`);
    const text = result.text ?? "";
    return {
      text,
      tool_calls: [],
      usage: {
        input_tokens: result.usage?.prompt_tokens ?? countTokens(messages.map((m) => m.content).join("\n")),
        output_tokens: result.usage?.completion_tokens ?? countTokens(text),
      },
      latency_ms: Date.now() - started,
      adapter: "nvidia",
      model: result.model ?? process.env.METERLESS_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b",
    };
  }
}

export class LlamaAdapter implements KeepAdapter {
  name = "llama";
  async generate(messages: ChatMessage[], _tools: string[], options?: KeepGenerateOptions): Promise<KeepGenerateResult> {
    const key = (process.env.LLAMA_API_KEY ?? "").trim();
    const base = (process.env.LLAMA_BASE_URL ?? "").trim();
    const model = options?.model ?? process.env.LLAMA_MODEL ?? "llama-3.1-70b";
    if (!key || !base) throw new Error("Missing adapter: set LLAMA_API_KEY and LLAMA_BASE_URL for the Llama adapter.");
    const started = Date.now();
    const out = await postJson(`${base.replace(/\/$/, "")}/chat/completions`, key, { model, messages, temperature: 0.2, max_tokens: options?.maxTokens ?? 800 }, 30000);
    return { text: out.text, tool_calls: [], usage: { input_tokens: out.input || countTokens(messages.map((m) => m.content).join("\n")), output_tokens: out.output || countTokens(out.text) }, latency_ms: Date.now() - started, adapter: "llama", model };
  }
}

export class GeminiAdapter implements KeepAdapter {
  name = "gemini";
  async generate(messages: ChatMessage[], _tools: string[], options?: KeepGenerateOptions): Promise<KeepGenerateResult> {
    const key = (process.env.GEMINI_API_KEY ?? "").trim();
    const model = options?.model ?? process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
    if (!key) throw new Error("Missing adapter: set GEMINI_API_KEY for the Gemini adapter.");
    const started = Date.now();
    const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents }), signal: controller.signal });
      if (!res.ok) {
        const b = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${b ? `: ${b.slice(0, 200)}` : ""}`);
      }
      const payload = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }>; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; text?: unknown; model?: unknown; modelId?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number }; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      const text: string | undefined = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
      if (!text) throw new Error("Empty completion text");
      return { text, tool_calls: [], usage: { input_tokens: payload.usageMetadata?.promptTokenCount ?? countTokens(messages.map((m) => m.content).join("\n")), output_tokens: payload.usageMetadata?.candidatesTokenCount ?? countTokens(text) }, latency_ms: Date.now() - started, adapter: "gemini", model };
    } finally {
      clearTimeout(t);
    }
  }
}

export type AdapterName = "mock" | "nvidia" | "llama" | "gemini";

export function getAdapter(name: AdapterName | string): KeepAdapter {
  switch (name) {
    case "mock":
      return new MockAdapter();
    case "nvidia":
      return new NvidiaAdapter();
    case "llama":
    case "gemini":
      throw new Error(`Adapter "${name}" is not approved in Phase 1. Use mock|nvidia only.`);
    default:
      throw new Error(`Unknown adapter "${name}". Choose mock|nvidia|llama|gemini.`);
  }
}

export function currentAdapterName(): string {
  const raw = (process.env.VOW_KEEP_ADAPTER ?? "mock").trim() || "mock";
  if (raw !== "mock" && raw !== "nvidia") throw new Error(`Adapter "${raw}" is not approved in Phase 1. Use mock|nvidia only.`);
  return raw;
}
