/**
 * Shared coercion helpers for the Dalmia Cement uploaders (dalmia_daildesk / Outbound / dalmia_apr /
 * after_hour).
 *
 * Why this exists: the uploader page reads Excel/CSV with SheetJS `raw: false`, i.e. every cell
 * arrives as the text Excel DISPLAYS, not its underlying serial number. Dalmia's sheets display
 * dates as "7/1/2026 10:12", "31-08-2026 21:27:02", "1-Jul-26", "9/2/2026" and long phone numbers as
 * "9.18235E+11" -- none of which the original ISO-only parsers understood. These helpers accept all of
 * those (plus Excel serials and ISO), so a sheet can be dropped in as-is.
 *
 * Date rules (documented because dd/mm vs mm/dd is genuinely ambiguous):
 *   - "a/b/yyyy" with slashes is read month/day (what Excel shows on a US-English machine and what all the
 *     Dalmia samples are: 7/1/2026 is 1 July, 9/2/2026 is 2 September); if a > 12 it can only be day/month.
 *   - "a-b-yyyy" with dashes is read day-month ("31-08-2026"); if b > 12 it can only be month-day.
 *   - "d-Mon-yy" / "d-Mon-yyyy" ("1-Jul-26") is unambiguous.
 */

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Lowercase letters/digits only -- how headers are compared ("E-Mail ID" == "email id" == "EMAILID"). */
export function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Re-keys an uploaded row onto the importer's canonical header names, matching headers case/space/
 * punctuation-insensitively, so "Call ID", "call id" and "Call Id" all reach `data["Call Id"]`.
 * A canonical header with no match is left absent; extra columns are kept untouched.
 */
export function canonicalizeRow(row: Record<string, unknown>, headers: readonly string[]): Record<string, unknown> {
  const byNorm = new Map<string, string>();
  for (const h of headers) byNorm.set(normalizeKey(h), h);
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(row)) {
    const canonical = byNorm.get(normalizeKey(k));
    if (canonical && canonical !== k && (out[canonical] === undefined || out[canonical] === "")) out[canonical] = v;
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "10:12", "21:27:02", "9:05 PM" -> seconds since midnight, or null. */
function parseTimePart(s: string): number | null {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  const ap = m[4]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return h * 3600 + min * 60 + sec;
}

function fromSerial(raw: number): { ymd: string; secs: number } {
  const days = Math.floor(raw);
  const secs = Math.round((raw - days) * 86400);
  const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
  return { ymd: d.toISOString().slice(0, 10), secs };
}

const hms = (secs: number): string => `${pad2(Math.floor(secs / 3600))}:${pad2(Math.floor((secs % 3600) / 60))}:${pad2(secs % 60)}`;

/** Any of the formats above -> { ymd: "YYYY-MM-DD", secs: seconds since midnight } or null. */
function parseDateParts(raw: unknown): { ymd: string; secs: number } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 20000 && raw < 80000 ? fromSerial(raw) : null;
  const v = String(raw).trim();
  if (!v) return null;

  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return n > 20000 && n < 80000 ? fromSerial(n) : null;
  }

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](.+))?$/.exec(v);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validYmd(y, mo, d)) return null;
    return { ymd: `${y}-${pad2(mo)}-${pad2(d)}`, secs: m[4] ? (parseTimePart(m[4]) ?? 0) : 0 };
  }

  m = /^(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s,]*(\d{2}|\d{4})(?:[ T,]+(.+))?$/.exec(v);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    let y = Number(m[3]);
    if (m[3].length === 2) y += 2000;
    const d = Number(m[1]);
    if (!mo || !validYmd(y, mo, d)) return null;
    return { ymd: `${y}-${pad2(mo)}-${pad2(d)}`, secs: m[4] ? (parseTimePart(m[4]) ?? 0) : 0 };
  }

  m = /^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})(?:[ T,]+(.+))?$/.exec(v);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    let y = Number(m[4]);
    if (m[4].length === 2) y += 2000;
    // slashes: month/day unless the first part can only be a day; dashes: day-month unless the second can only be a day.
    const monthFirst = m[2] === "/" ? a <= 12 : !(b <= 12);
    const [mo, d] = monthFirst ? [a, b] : [b, a];
    if (!validYmd(y, mo, d)) return null;
    return { ymd: `${y}-${pad2(mo)}-${pad2(d)}`, secs: m[5] ? (parseTimePart(m[5]) ?? 0) : 0 };
  }
  return null;
}

/** -> "YYYY-MM-DD HH:mm:ss" or null. */
export function parseFlexibleDateTime(raw: unknown): string | null {
  const p = parseDateParts(raw);
  return p ? `${p.ymd} ${hms(p.secs)}` : null;
}

/** -> "YYYY-MM-DD" or null. */
export function parseFlexibleDate(raw: unknown): string | null {
  return parseDateParts(raw)?.ymd ?? null;
}

/** A clock time ("9:32:52", "19:01:07", Excel day-fraction 0.4) -> "HH:mm:ss" or null. */
export function parseClockTime(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw < 1) return hms(Math.round(raw * 86400));
  const v = String(raw).trim();
  if (!v) return null;
  if (/^0?\.\d+$/.test(v)) return hms(Math.round(Number(v) * 86400));
  const secs = parseTimePart(v);
  return secs === null ? null : hms(secs);
}

/**
 * A duration -> whole seconds, or null when blank. Accepts "7:46:42" / "0:20:55" (h:mm:ss, hours may exceed 24),
 * "12:30" (mm:ss is NOT assumed -- two parts are read as h:mm), an Excel day-fraction (0.3238 -> 27,977s),
 * or a plain number of seconds ("162").
 */
export function parseDurationSeconds(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? (raw < 1 ? Math.round(raw * 86400) : Math.round(raw)) : null;
  const v = String(raw).trim();
  if (!v || v === "-") return null;
  const m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(v);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + (m[3] ? Number(m[3]) : 0);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return v.includes(".") && n < 1 ? Math.round(n * 86400) : Math.round(n);
}

export function parseLooseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** "43%" or 0.43 -> 43 (a percentage number), or null. */
export function parsePercent(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  const n = Number(s.replace(/%/g, "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (s.includes("%")) return Math.round(n * 100) / 100;
  return n > 0 && n <= 1 ? Math.round(n * 10000) / 100 : Math.round(n * 100) / 100;
}

export function cleanText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

/** True for a value Excel has already rounded into scientific notation ("9.18235E+11") -- the digits are gone. */
export function isScientificNotation(raw: unknown): boolean {
  return /^\d+(\.\d+)?e[+-]?\d+$/i.test(String(raw ?? "").trim());
}

/**
 * A phone number as text, digits only. Prefers `primary`; if that is blank or Excel-rounded scientific
 * notation, falls back to `fallback` (Dalmia's after-hour sheet carries the same number twice -- "Contact No"
 * is often shown as 9.18235E+11 while "Number" keeps the real digits). Returns null when neither is usable.
 */
export function cleanPhone(primary: unknown, fallback?: unknown): string | null {
  const usable = (x: unknown): string | null => {
    const s = String(x ?? "").trim();
    if (!s || isScientificNotation(s)) return null;
    const digits = s.replace(/[^\d+]/g, "");
    return digits.length >= 5 ? digits : null;
  };
  return usable(primary) ?? usable(fallback);
}
