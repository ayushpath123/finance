import { execSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL to a disposable database (its schema will be dropped).");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error("TEST_DATABASE_URL must not be the application DATABASE_URL.");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
