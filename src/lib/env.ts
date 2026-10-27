import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const envSchema = z.object({
  METERLESS_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("http://127.0.0.1:8088/v1")),
  METERLESS_API_KEY: z.preprocess(emptyToUndefined, z.string().optional().default("")),
  METERLESS_MODEL: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("nvidia/nemotron-3-ultra-550b-a55b"),
  ),
  METERLESS_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  METERLESS_INPUT_COST_PER_1K: z.coerce.number().nonnegative().default(0),
  METERLESS_OUTPUT_COST_PER_1K: z.coerce.number().nonnegative().default(0),
  VOW_WORKSPACE_DIR: z.preprocess(emptyToUndefined, z.string().min(1).default("./data/workspace")),
  VOW_DATA_DIR: z.preprocess(emptyToUndefined, z.string().min(1).default("./data")),
  VOW_WORKER_TOKEN: z.preprocess(emptyToUndefined, z.string().optional().default("")),
  VOW_WORKER_TICK_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
  ZETARIS_REST_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default("http://localhost:8888/api/v1.0"),
  ),
  ZETARIS_ORG_ID: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("1"),
  ),
  ZETARIS_API_KEY: z.preprocess(
    emptyToUndefined,
    z.string().optional().default(""),
  ),
  ZETARIS_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  NODE_ENV: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  cached = envSchema.parse({
    METERLESS_BASE_URL: process.env.METERLESS_BASE_URL,
    METERLESS_API_KEY: process.env.METERLESS_API_KEY,
    METERLESS_MODEL: process.env.METERLESS_MODEL,
    METERLESS_TIMEOUT_MS: process.env.METERLESS_TIMEOUT_MS,
    METERLESS_INPUT_COST_PER_1K: process.env.METERLESS_INPUT_COST_PER_1K,
    METERLESS_OUTPUT_COST_PER_1K: process.env.METERLESS_OUTPUT_COST_PER_1K,
    VOW_WORKSPACE_DIR: process.env.VOW_WORKSPACE_DIR,
    VOW_DATA_DIR: process.env.VOW_DATA_DIR,
    VOW_WORKER_TOKEN: process.env.VOW_WORKER_TOKEN,
    VOW_WORKER_TICK_PER_MINUTE: process.env.VOW_WORKER_TICK_PER_MINUTE,
    ZETARIS_REST_URL: process.env.ZETARIS_REST_URL,
    ZETARIS_ORG_ID: process.env.ZETARIS_ORG_ID,
    ZETARIS_API_KEY: process.env.ZETARIS_API_KEY,
    ZETARIS_TIMEOUT_MS: process.env.ZETARIS_TIMEOUT_MS,
    NODE_ENV: process.env.NODE_ENV,
  });
  return cached;
}

export function hasMeterlessKey(): boolean {
  return Boolean(getEnv().METERLESS_API_KEY?.trim());
}

export function resetEnvCache() {
  cached = null;
}
