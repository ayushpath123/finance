import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * HTTP end-to-end tests against a RUNNING production server:
 *   npm run build && npm start   (with DATABASE_URL + AUTH_SECRET)
 *   E2E_BASE_URL=http://localhost:3000 DATABASE_URL=<same db> npm run test:e2e
 * Creates its own throwaway accounts (90000001xx); never touches the real admins.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
