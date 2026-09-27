/**
 * Side-effect import for CLI scripts: loads .env.local, then .env, the same
 * precedence Next.js uses. Must be the FIRST import so env is set before any
 * module (e.g. the Prisma client) reads it. Existing process env always wins.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
