/**
 * Fails if anything secret or server-only is present in files shipped to the browser
 * (.next/static). Run after `next build`:
 *   npm run security:scan
 * The actual AUTH_SECRET / DATABASE_URL values from the build environment are checked too.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".next/static";
const needles = [
  "DATABASE_URL", "AUTH_SECRET", "INITIAL_ADMIN_", "CRON_SECRET",
  "postgresql://", "postgres://", "neon.tech", "npg_",
  "passwordHash", "$argon2id$", "@node-rs/argon2", "@prisma/client", "PrismaClient",
  "validateSessionToken", "authenticateWithPassword", "hashToken", "revokeUserSessions",
];
for (const name of ["AUTH_SECRET", "DATABASE_URL", "CRON_SECRET"]) {
  const v = process.env[name];
  if (v && v.length >= 8) needles.push(v);
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

let scanned = 0;
const hits = [];
for (const file of files(ROOT)) {
  if (!/\.(js|css|json|html|txt|map)$/.test(file)) continue;
  scanned++;
  const text = readFileSync(file, "utf8");
  for (const n of needles) if (text.includes(n)) hits.push(`${file}: contains ${n.length > 24 ? `${n.slice(0, 6)}…(env value)` : JSON.stringify(n)}`);
}

if (hits.length) {
  console.error(`✗ ${hits.length} secret/server-only reference(s) in client bundle:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ Scanned ${scanned} client files: no secrets, connection strings, password hashing or server-only auth code.`);
