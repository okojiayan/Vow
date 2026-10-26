import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Live-backend benchmark: needs a fresh stability-gate record from the
    // scheduled pipeline (Meterless auth). Excluded from the default local
    // run; run it explicitly after: node scripts/bench-stability-gate.mjs
    // --outdir=tests/evals/reports/nemotron-vs-full-100 --chats=3
    exclude: ["tests/evals/nemotron-vs-full-100.test.ts"],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
