/** Client-safe formatting re-exports (no server-only imports). */
export { formatDay, formatDayFull, formatDayShort, formatMonth, PAYMENT_METHOD_LABEL, relativeDay } from "./format";
import { formatINR as fmt, type Paise } from "./finance/money";

export const formatINR = (p: number) => fmt(p as Paise);
