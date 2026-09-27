/**
 * node-postgres currently treats sslmode=prefer|require|verify-ca as verify-full
 * (full certificate + hostname verification) and prints a SECURITY WARNING on
 * every connect because that will change to weaker libpq semantics in pg v9.
 *
 * We make today's behaviour explicit — verify-full — which silences the warning
 * AND guarantees the strict behaviour survives the pg upgrade. Neon serves valid
 * certificates, so this changes nothing about how the connection works now.
 * URLs without sslmode (e.g. a local Postgres) and sslmode=disable are left alone.
 */
export function normalizeConnectionString(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // let pg report the malformed URL itself
  }
  const mode = parsed.searchParams.get("sslmode");
  if (mode === "prefer" || mode === "require" || mode === "verify-ca") {
    parsed.searchParams.set("sslmode", "verify-full");
  }
  return parsed.toString();
}
