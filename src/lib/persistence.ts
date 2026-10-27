import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

const queues = new Map<string, Promise<void>>();

async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(filePath) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(
    filePath,
    previous.then(() => current),
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function dataPath(...parts: string[]): string {
  return path.resolve(process.cwd(), getEnv().VOW_DATA_DIR, ...parts);
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  // Retry on torn reads: concurrent writers use atomic rename, but a reader
  // may still race a rename on some filesystems. Bounded retries keep
  // parallel tasks honest instead of surfacing "Unexpected end of JSON input".
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const raw = await readFile(filePath, "utf8");
      if (raw.trim() === "") return fallback;
      return JSON.parse(raw) as T;
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { code?: string };
      if (err.code === "ENOENT") return fallback;
      lastError = error;
      if (error instanceof SyntaxError && attempt < 4) {
        await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1e9)}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, filePath);
}

export async function mutateJsonFile<T>(
  filePath: string,
  fallback: T,
  mutator: (current: T) => T | Promise<T>,
): Promise<T> {
  return withLock(filePath, async () => {
    const current = await readJsonFile<T>(filePath, fallback);
    const next = await mutator(current);
    await writeJsonFile(filePath, next);
    return next;
  });
}
