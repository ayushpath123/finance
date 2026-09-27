import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/finance/**/*.test.ts", "tests/auth/**/*.test.ts"],
    environment: "node",
    // next-auth imports "next/server" without an extension; let Vite resolve it.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
  },
});
