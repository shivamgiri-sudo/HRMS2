// backend/src/modules/client-billing/client-billing-validation.ts
/**
 * Input rules shared by proforma create / edit and credit notes (audit 2026-10-14 M1, L3).
 * Pure: no DB access.
 */
import { assertFinanceYear } from "./client-billing-tax.js";

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function assertIsoDate(value: unknown, label: string): string {
  const s = String(value ?? "").trim();
  const m = ISO_DATE.exec(s);
  if (!m) throw badRequest(`${label} must be a date in YYYY-MM-DD form (got "${s.slice(0, 20)}")`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw badRequest(`${label} ${s} is not a real calendar date`);
  }
  return s;
}

/**
 * M1, legacy rule: the invoice / credit date is free, but it must fall inside the finance year
 * (1 April of the start year .. 31 March of the next).
 */
export function assertDateInFinanceYear(value: unknown, financeYear: string, label: string): string {
  const date = assertIsoDate(value, label);
  assertFinanceYear(financeYear);
  const start = Number(financeYear.slice(0, 4));
  const from = `${start}-04-01`;
  const to = `${start + 1}-03-31`;
  if (date < from || date > to) {
    throw badRequest(`${label} ${date} is outside finance year ${financeYear} (${from} to ${to})`);
  }
  return date;
}

export const LINE_TYPES = ["charge", "deduction"] as const;
export type LineType = (typeof LINE_TYPES)[number];

export interface BillLineInput {
  particulars: string;
  qty: number;
  rate: number;
  lineType?: LineType;
}

/**
 * Proforma lines (L3 + H6): particulars 1..255 chars, qty > 0, rate >= 0, lineType only
 * 'charge' / 'deduction', and at least one charge line.
 */
export function validateBillLines(lines: unknown): BillLineInput[] {
  if (!Array.isArray(lines) || lines.length === 0) throw badRequest("At least one line item is required");
  if (lines.length > 200) throw badRequest("At most 200 line items");
  for (const line of lines as Array<Partial<BillLineInput>>) {
    const particulars = String(line?.particulars ?? "").trim();
    if (!particulars) throw badRequest("Every line needs particulars");
    if (particulars.length > 255) throw badRequest("Particulars are at most 255 characters");
    if (!Number.isFinite(line?.qty) || Number(line?.qty) <= 0) throw badRequest("Line quantity must be greater than zero");
    if (!Number.isFinite(line?.rate) || Number(line?.rate) < 0) throw badRequest("Line rate must be zero or more");
    if (line?.lineType !== undefined && line.lineType !== null && !(LINE_TYPES as readonly string[]).includes(String(line.lineType))) {
      throw badRequest(`lineType must be one of ${LINE_TYPES.join(", ")}`);
    }
  }
  const typed = lines as BillLineInput[];
  if (!typed.some((l) => (l.lineType ?? "charge") === "charge")) {
    throw badRequest("At least one charge line is required");
  }
  return typed;
}

/** Narration / description: optional, at most 255 characters (the column width). */
export function assertDescription(value: unknown): void {
  if (value === undefined || value === null) return;
  if (String(value).trim().length > 255) throw badRequest("Description is at most 255 characters");
}
