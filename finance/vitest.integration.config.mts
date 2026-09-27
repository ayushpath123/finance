import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Runs the financial services against a REAL Postgres (local or a Neon branch).
 *   TEST_DATABASE_URL=postgres://… npm run test:integration
 * The target database's public schema is DROPPED and re-migrated.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // next-auth imports "next/server" without an extension; let Vite resolve it.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    globalSetup: ["tests/integration/global-setup.ts"],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", DATABASE_POOL_MAX: "10" },
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
