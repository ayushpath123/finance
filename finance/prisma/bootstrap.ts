/**
 * Creates the initial administrator accounts from the environment.
 *
 *   INITIAL_ADMIN_1_MOBILE=…  INITIAL_ADMIN_1_PASSWORD=…
 *   INITIAL_ADMIN_2_MOBILE=…  INITIAL_ADMIN_2_PASSWORD=…
 *   npm run db:seed
 *
 * Safe to run any number of times: existing accounts are left untouched
 * (passwords are never overwritten). Passwords are never printed.
 */
import "../scripts/load-env";
import { adminSeedsFromEnv, bootstrapAdmins } from "@/lib/auth/bootstrap";
import { prisma } from "@/lib/db/client";


async function main() {
  const seeds = adminSeedsFromEnv();
  if (seeds.length === 0) {
    console.error("No INITIAL_ADMIN_<n>_MOBILE / _PASSWORD variables set.");
    process.exit(1);
  }
  await prisma.businessSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const results = await bootstrapAdmins(seeds);
  for (const r of results) {
    if (r.status === "skipped") console.warn(`✗ ${r.label}: ${r.reason}`);
    else console.log(`${r.status === "created" ? "✓ created" : "• exists "} ${r.label}: ${r.mobileNumber} (ADMIN)`);
  }
  if (results.some((r) => r.status === "skipped")) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
