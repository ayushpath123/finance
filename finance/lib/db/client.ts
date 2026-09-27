import "server-only";
import net from "node:net";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/lib/generated/prisma/client";
import { normalizeConnectionString } from "./connection-string";

/**
 * One PrismaClient per server process (reused across hot reloads in dev).
 * node-postgres over TCP works with Neon's pooled endpoint and with any
 * standard Postgres, so the same code runs in production and in tests.
 */
/**
 * Node's "happy eyeballs" gives each resolved address only 250 ms before trying
 * the next. Neon publishes IPv6 + IPv4; where IPv6 isn't routable (WSL2, many
 * home/office networks) and the region is far away (India → us-east-2 ≈ 250–550 ms),
 * IPv4 attempts get abandoned just before succeeding and the connect fails with
 * ETIMEDOUT (~35% of attempts measured). 2 s per attempt makes it reliable.
 */
net.setDefaultAutoSelectFamilyAttemptTimeout?.(2_000);

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({
    connectionString: normalizeConnectionString(connectionString),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    connectionTimeoutMillis: 15_000, // includes a Neon compute cold start
    keepAlive: true,
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __artiPrisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.__artiPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__artiPrisma = prisma;

export type Db = typeof prisma;
/** The client handed to `prisma.$transaction(async (tx) => …)`. */
export type Tx = Prisma.TransactionClient;

/** Financial transactions can touch ~100 schedule rows; allow for Neon round-trips. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;
