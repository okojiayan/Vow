type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_KEY = /key|token|secret|password|authorization|api[_-]?key/i;

function redactValue(value: unknown, key: string): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return scrubSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactValue(v, k)]),
    );
  }
  return value;
}

function redact(extra?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!extra) return extra;
  return Object.fromEntries(
    Object.entries(extra).map(([key, value]) => [key, redactValue(value, key)]),
  );
}

function scrubSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"',}]+["']?/gi, "$1=[redacted]");
}

function emit(level: LogLevel, message: string, extra?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message: scrubSecrets(message),
    ...redact(extra),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>) => emit("debug", message, extra),
  info: (message: string, extra?: Record<string, unknown>) => emit("info", message, extra),
  warn: (message: string, extra?: Record<string, unknown>) => emit("warn", message, extra),
  error: (message: string, extra?: Record<string, unknown>) => emit("error", message, extra),
};
