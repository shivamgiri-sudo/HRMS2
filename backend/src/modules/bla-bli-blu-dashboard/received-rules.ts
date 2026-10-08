/**
 * BBB Received Data rules (Today_Only_Data_Upload_Logic_Requirement). Pure, so each rule is a unit test:
 *   - one row per DATE + mobile number (never per number alone);
 *   - the same number on a later date is a valid new row;
 *   - a row is "NC" when the same number has a row in the previous 1-3 calendar days, otherwise "Fresh".
 */

export interface IncomingRow {
  date: string | null; phone: unknown;
  lob?: string | null; sourceDataType?: string | null; workable?: string | null; callAnswer?: string | null;
  sameDayAttempt?: number; finalDispo?: string | null; empId?: string | null; empName?: string | null;
}
export interface PlannedRow extends Omit<IncomingRow, "phone" | "date"> { date: string; phone: string; index: number }
export interface ReceivedPlan {
  insert: PlannedRow[];
  /** Indexes (into the incoming list) of rows whose date + number already exists, in the table or earlier in the file. */
  duplicateSameDay: number[];
  noNumber: number[];
  noDate: number[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The 10-digit mobile number a row is keyed on: digits only, country code / leading zero dropped. null = unusable. */
export function normalizeNumber10(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // A number cell exported in scientific notation (9.87654321E9).
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) { const n = Number(s); if (Number.isFinite(n)) s = String(Math.round(n)); }
  const digits = s.replace(/\.0+$/, "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export const keyOf = (date: string, phone: string): string => `${date}|${phone}`;

/** Decide, row by row, what may be inserted. `existing` holds date|number keys of live rows already stored. */
export function planReceived(rows: readonly IncomingRow[], existing: ReadonlySet<string>): ReceivedPlan {
  const plan: ReceivedPlan = { insert: [], duplicateSameDay: [], noNumber: [], noDate: [] };
  const seen = new Set<string>();
  rows.forEach((r, index) => {
    if (!r.date || !ISO.test(r.date)) { plan.noDate.push(index); return; }
    const phone = normalizeNumber10(r.phone);
    if (!phone) { plan.noNumber.push(index); return; }
    const key = keyOf(r.date, phone);
    if (existing.has(key) || seen.has(key)) { plan.duplicateSameDay.push(index); return; }
    seen.add(key);
    plan.insert.push({ ...r, date: r.date, phone, index });
  });
  return plan;
}

const dayNumber = (d: string): number => { const [y, m, dd] = d.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, dd) / 86_400_000); };
export const NC_WINDOW_DAYS = 3;

/**
 * Fresh or NC for a row on `date`, given every other date the same number has a live row on.
 * The SQL in reclassifyReceived() applies exactly this rule; this function is its specification.
 */
export function classify(date: string, otherDates: readonly string[]): "Fresh" | "NC" {
  const d = dayNumber(date);
  return otherDates.some((o) => { const gap = d - dayNumber(o); return gap >= 1 && gap <= NC_WINDOW_DAYS; }) ? "NC" : "Fresh";
}
