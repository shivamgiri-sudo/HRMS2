/**
 * Pure value coercion for Onfido bulk-upload rows (no DB access, so it is unit-testable).
 * Every parser returns null rather than throwing: a raw analytics export is not expected
 * to always carry a well-formed value, and one bad cell must not fail its whole row.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Onfido/IMS exports mix several date-ish formats in the same column
 * ("1-Jul-26", "7/1/26 14:17", "2026-07"). Returns a MySQL DATE string
 * (YYYY-MM-DD) or null — never throws, since a raw analytics export is not
 * expected to always carry a well-formed date.
 */
export function parseFlexibleDate(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const dMonY = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(value);
  if (dMonY) {
    const month = MONTHS[dMonY[2].toLowerCase()];
    if (month) {
      const year = dMonY[3].length === 2 ? 2000 + Number(dMonY[3]) : Number(dMonY[3]);
      return `${year}-${String(month).padStart(2, "0")}-${dMonY[1].padStart(2, "0")}`;
    }
  }

  const mdY = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+\d{1,2}:\d{2})?/.exec(value);
  if (mdY) {
    const year = mdY[3].length === 2 ? 2000 + Number(mdY[3]) : Number(mdY[3]);
    return `${year}-${mdY[1].padStart(2, "0")}-${mdY[2].padStart(2, "0")}`;
  }

  const isoYm = /^(\d{4})-(\d{2})$/.exec(value);
  if (isoYm) return `${isoYm[1]}-${isoYm[2]}-01`;

  const isoYmd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoYmd) return `${isoYmd[1]}-${isoYmd[2]}-${isoYmd[3]}`;

  const native = new Date(value);
  if (!Number.isNaN(native.getTime())) return native.toISOString().slice(0, 10);

  return null;
}

export function parseInt10(raw: unknown): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Unlike parseInt10, keeps the fraction — some shrinkage/UL columns are genuinely
 *  half-day values (e.g. "Actual UL" of -0.5), not whole counts. */
export function parseFloatValue(raw: unknown): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * A percentage the way the Hub receives it. XLSX -> CSV emits each cell as the sheet
 * DISPLAYED it, so a percent-formatted cell arrives as "93.0%" while a General-formatted
 * one arrives as "0.93" — both are the ratio 0.93. Treating "93.0%" as 93 (what the
 * generic float parse does) stores percentage points where every reader expects a ratio.
 * Kept to 6 decimals: the source's own display precision is the most it ever carries.
 */
export function parseRatio(raw: unknown): number | null {
  const value = String(raw ?? "").trim();
  if (!/\d/.test(value)) return null; // "n/a", "-" and blanks carry no number — not 0
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return null;
  const ratio = value.endsWith("%") ? n / 100 : n;
  return Math.round(ratio * 1_000_000) / 1_000_000;
}

export function parseBoolYesNo(raw: unknown): 0 | 1 | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  return value === "yes" || value === "y" || value === "true" || value === "1" ? 1 : 0;
}

export function coerce(type: "string" | "date" | "int" | "float" | "ratio" | "bool_yes_no", raw: unknown): unknown {
  switch (type) {
    case "date": return parseFlexibleDate(raw);
    case "int": return parseInt10(raw);
    case "float": return parseFloatValue(raw);
    case "ratio": return parseRatio(raw);
    case "bool_yes_no": return parseBoolYesNo(raw);
    default: {
      const s = String(raw ?? "").trim();
      return s === "" ? null : s.slice(0, 500);
    }
  }
}
