import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Same precedence as Next.js: .env.local overrides .env; real env overrides both.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --tsconfig tsconfig.json --conditions=react-server prisma/bootstrap.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
