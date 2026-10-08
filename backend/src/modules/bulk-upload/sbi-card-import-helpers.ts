import { parseFlexibleDate, parseFlexibleDateTime, parseClockTime, parseLooseNumber, cleanText, isScientificNotation } from "./dalmia-import-helpers.js";
import type { SbiCol } from "./sbi-card-schema.js";

export { cleanText };

/** Number from a cell, null for blank / "-" / "#DIV/0!" / any non-numeric text. */
export function numOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || s === "-" || s.startsWith("#")) return null;
  return parseLooseNumber(s);
}

export function intOrNull(raw: unknown): number | null {
  const n = numOrNull(raw);
  return n === null ? null : Math.round(n);
}

/** Decimal rounded to 4 places (fits DECIMAL(x,4)). */
export function decOrNull(raw: unknown): number | null {
  const n = numOrNull(raw);
  return n === null ? null : Math.round(n * 10000) / 10000;
}

export function coerceCol(c: SbiCol, raw: unknown): number | null {
  return c.kind === "int" ? intOrNull(raw) : decOrNull(raw);
}

/** A sheet date; dates before 2000 (Excel shows a blank day counter as 1900-01-xx) are rejected by the shared parser. */
export function parseSbiDate(raw: unknown): string | null {
  const d = raw instanceof Date ? (Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10)) : parseFlexibleDate(raw);
  // A blank day counter (Excel serial 1..31) renders as "1/1/00".."31/1/00", which a two-digit-year reader turns into 2000-01-xx
  // (seen live on the Master / Overall rollup sheets). No SBI Card report predates 2010, so anything earlier is not a real day.
  return d && d >= "2010-01-01" ? d : null;
}

/** A call / callback timestamp -> "YYYY-MM-DD HH:mm:ss" (Excel serials and Date objects included), null when blank or pre-2010. */
export function parseSbiDateTime(raw: unknown): string | null {
  const v = raw instanceof Date ? (Number.isNaN(raw.getTime()) ? null : raw.toISOString().replace("T", " ").slice(0, 19)) : parseFlexibleDateTime(raw);
  return v && v >= "2010-01-01" ? v : null;
}

/** "9:00:46" / "18:40" / Excel day fraction -> "HH:mm:ss" or null. */
export function parseSbiTime(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s === "-" || s.startsWith("#")) return null;
  return parseClockTime(raw);
}

/** "0:00:46" / "00:15" / 0.0005 -> whole seconds (leakage of the day). Plain numbers are read as seconds. */
export function parseSeconds(raw: unknown): number | null {
  const t = parseSbiTime(raw);
  if (t) { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + s; }
  const n = numOrNull(raw);
  return n === null || n < 0 ? null : Math.round(n);
}

/**
 * The tracker's "Downtime Minutes" is an h:mm duration ("4:20" = 260 minutes, "0:15" = 15); a plain number is already minutes.
 */
export function parseDowntimeMinutes(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || s === "-" || s.startsWith("#")) return null;
  const m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
  if (typeof raw === "number" && raw > 0 && raw < 1) return Math.round(raw * 1440);
  return numOrNull(s);
}

/** Dialer call-table names end in a ddmmyyyy stamp ("AL_MUM_CD3_HB_19082026") -> "2026-08-19". */
export function dateFromCallTable(name: string): string | null {
  const m = /(\d{2})(\d{2})(\d{4})$/.exec(name.trim());
  return m ? parseFlexibleDate(`${m[3]}-${m[2]}-${m[1]}`) : null;
}

/** Team / leader cells hold a literal 0 when the workbook's lookup failed -- that means "unknown", not a team named "0". */
export function cleanTeam(raw: unknown): string | null {
  const v = cleanText(raw);
  return v === null || v === "0" || v === "-" ? null : v;
}

/** An identifier cell (employee id, account no) as text; Excel floats like 600264364.0 lose the ".0". */
export function cleanId(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "-" || v === "0" || isScientificNotation(v)) return null;
  return /^\d+\.0+$/.test(v) ? v.replace(/\.0+$/, "") : v;
}
