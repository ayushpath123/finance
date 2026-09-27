/**
 * Money is always an integer number of paise (₹1 = 100 paise).
 *
 * JS numbers represent integers exactly up to 2^53, so integer paise
 * arithmetic is exact; floating-point error only appears once fractions are
 * involved. We therefore never multiply/divide rupee floats — parsing is done
 * on the decimal string, and every result is asserted to be a safe integer.
 *
 * Per-row amounts are stored as Postgres INTEGER (max ₹2,14,74,836.47);
 * aggregates are summed in JS/bigint and are not bounded by that limit.
 */

export type Paise = number & { readonly __brand: "Paise" };

/** Largest single amount that fits a Postgres INTEGER column. */
export const MAX_ROW_PAISE = 2_147_483_647 as Paise;

export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be an integer number of paise, got ${value}`);
  }
  return value as Paise;
}

export const ZERO = 0 as Paise;

const RUPEE_INPUT = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parse user input in rupees ("1500", "1,500.5", "₹1,50,000.00") to paise
 * without floating-point math. Returns null for anything that isn't a
 * non-negative amount with at most 2 decimal places.
 */
export function parseRupees(input: string | number): Paise | null {
  const raw = typeof input === "number" ? numberToPlainString(input) : input;
  if (raw === null) return null;
  const cleaned = raw.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  const match = RUPEE_INPUT.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const value = whole * 100 + fraction;
  return Number.isSafeInteger(value) ? (value as Paise) : null;
}

function numberToPlainString(n: number): string | null {
  if (!Number.isFinite(n) || n < 0) return null;
  // toString() never produces more digits than needed to round-trip, so
  // 1500.5 -> "1500.5" and 0.1 -> "0.1"; exponent notation is rejected.
  const s = n.toString();
  return /e/i.test(s) ? null : s;
}

export function add(a: Paise, b: Paise): Paise {
  return paise(a + b);
}

export function sub(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

export function sum(values: Iterable<Paise>): Paise {
  let total = 0;
  for (const v of values) total += v;
  return paise(total);
}

export function mulInt(amount: Paise, factor: number): Paise {
  if (!Number.isSafeInteger(factor)) throw new RangeError(`Factor must be an integer, got ${factor}`);
  return paise(amount * factor);
}

export function min(a: Paise, b: Paise): Paise {
  return (a < b ? a : b) as Paise;
}

export function max(a: Paise, b: Paise): Paise {
  return (a > b ? a : b) as Paise;
}

/** floor(amount * numerator / denominator), computed exactly with bigint. */
export function prorate(amount: Paise, numerator: Paise, denominator: Paise): Paise {
  if (denominator <= 0) throw new RangeError("Denominator must be positive");
  const result = (BigInt(amount) * BigInt(numerator)) / BigInt(denominator);
  return paise(Number(result));
}

const rupeeFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/**
 * ₹50,000 · ₹1,25,000 · ₹12,50,000 · ₹750.50 · -₹250
 * Paise are shown only when non-zero (or always, with `alwaysShowPaise`).
 */
export function formatINR(amount: Paise, opts: { alwaysShowPaise?: boolean } = {}): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const rupees = Math.trunc(abs / 100);
  const rem = abs % 100;
  const fraction = rem !== 0 || opts.alwaysShowPaise ? `.${String(rem).padStart(2, "0")}` : "";
  return `${negative ? "-" : ""}₹${rupeeFormatter.format(rupees)}${fraction}`;
}
