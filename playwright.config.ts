import { defineConfig } from "vitest/config";

/**
 * Playwright is reserved for optional browser smoke tests.
 * Unit, integration, and evaluation coverage run through Vitest.
 * This file stays as a placeholder config so the repo layout remains intact.
 */
export default defineConfig({
  test: {
    include: [],
  },
});
