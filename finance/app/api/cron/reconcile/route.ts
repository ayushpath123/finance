import { timingSafeEqual } from "node:crypto";
import { reconcileDailyCollections } from "@/lib/services/reconciliation";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Vercel Cron calls this at 00:05 IST (see vercel.json). Safe to call repeatedly. */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const summary = await reconcileDailyCollections("CRON");
  return Response.json(summary);
}
