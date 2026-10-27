import path from "node:path";
import { defineConfig } from "vitest/config";

// Temporary Phase-2Z-only config (easy-medium tier and later tiers).
// Mirrors vitest.config.ts WITHOUT the live-backend nemotron exclude, so the
// gated sequential benchmark entry point can run explicitly after its
// readiness gate. Default `vitest run` behavior is untouched.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
