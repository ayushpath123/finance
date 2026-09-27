/**
 * Canonical form of an Indian mobile number: exactly 10 digits, starting 6–9.
 * Accepts common input variants so the same person can't end up with two
 * accounts (or be locked out) because of formatting:
 *   "9316568042", "93165 68042", "+91 93165-68042", "+919316568042", "09316568042", "919316568042"
 */
export function normalizeMobile(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!/^[+\d\s().-]*$/.test(trimmed)) return null; // letters etc. are never valid
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** "9316568042" → "93165 68042" for display. */
export function formatMobile(mobile: string): string {
  return /^\d{10}$/.test(mobile) ? `${mobile.slice(0, 5)} ${mobile.slice(5)}` : mobile;
}
