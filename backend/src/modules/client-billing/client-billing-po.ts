/**
 * PO / GRN / JCC helpers for client invoices (pure + one read-only DB check).
 *
 * Legacy `InitialInvoicesController::check_po_number` was inverted: it subtracted each PO's
 * balance from the invoice total and flagged an error when the remainder was >= 0, i.e.
 * it raised "PO Amount is less than Grand Total" even when the POs covered the invoice
 * exactly. The correct rules implemented here:
 *   1. at most 4 PO numbers per invoice;
 *   2. every PO number must exist for the invoice's cost centre;
 *   3. the invoice date must fall inside that PO's [period_from, period_to];
 *   4. the invoice grand total must NOT exceed the combined remaining balance of the POs
 *      that cover it (block only when total > balance);
 *   5. a PO still waiting for approval in the PO master (new, or amount increased) or rejected
 *      there cannot be used (maker-checker, audit 2026-10-14).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { round2 } from "./client-billing-tax.js";

export const MAX_PO_NUMBERS = 4;
const PO_NUMBER_MAX_LENGTH = 60;

export interface PoRow {
  id: string;
  po_number?: string;
  period_from?: string | null;
  period_to?: string | null;
  balance_amount: number | string;
  /** PO master approval; absent = approved (callers that do not select it). */
  approval_status?: string | null;
}

export interface PoCoverageInput {
  poNumbers: string[];
  poRows: PoRow[];
  invoiceDate: string | null | undefined;
  grandTotal: number;
}

export interface PoCoverageResult {
  ok: boolean;
  errors: string[];
  /** The PO rows whose period covers the invoice date (the ones that will be drawn down). */
  usableRows: PoRow[];
  totalBalance: number;
}

/** Trims, de-duplicates (case-insensitive) and drops blanks; accepts CSV or an array. */
export function parsePoNumbers(
  raw: string | string[] | null | undefined,
): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = String(part ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Throws a 400-style Error when the PO list itself is malformed. */
export function assertPoNumbersShape(poNumbers: string[]): void {
  if (poNumbers.length > MAX_PO_NUMBERS) {
    throw Object.assign(
      new Error(
        `Cannot attach more than ${MAX_PO_NUMBERS} PO numbers to a single invoice`,
      ),
      { statusCode: 400 },
    );
  }
  for (const po of poNumbers) {
    if (po.length > PO_NUMBER_MAX_LENGTH) {
      throw Object.assign(
        new Error(
          `PO number "${po.slice(0, 20)}…" is longer than ${PO_NUMBER_MAX_LENGTH} characters`,
        ),
        { statusCode: 400 },
      );
    }
  }
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return m ? m[1] : null;
}

/**
 * Pure rule evaluation. Period / identity checks run only on rows that actually carry the
 * field, so callers that selected a narrower column list degrade to the balance rule.
 */
export function validatePoCoverage(input: PoCoverageInput): PoCoverageResult {
  const errors: string[] = [];
  const invoiceDate = dateOnly(input.invoiceDate);

  const present = new Set(
    input.poRows
      .map((r) => (r.po_number ? r.po_number.toLowerCase() : null))
      .filter((x): x is string => x !== null),
  );
  const rowsCarryNumbers = input.poRows.some((r) => r.po_number);
  if (
    rowsCarryNumbers ||
    (input.poRows.length === 0 && input.poNumbers.length > 0)
  ) {
    for (const po of input.poNumbers) {
      if (!present.has(po.toLowerCase())) {
        errors.push(`PO Number ${po} not matched for this cost centre`);
      }
    }
  }

  const usableRows: PoRow[] = [];
  const outOfPeriod = new Set<string>();
  for (const row of input.poRows) {
    const approval = row.approval_status ?? "approved";
    if (approval !== "approved") {
      errors.push(
        approval === "pending"
          ? `PO Number ${row.po_number ?? row.id} is waiting for approval in the PO master and cannot be used yet`
          : `PO Number ${row.po_number ?? row.id} was rejected in the PO master and cannot be used`,
      );
      continue;
    }
    const from = dateOnly(row.period_from);
    const to = dateOnly(row.period_to);
    if (invoiceDate && from && to && (invoiceDate < from || invoiceDate > to)) {
      if (row.po_number) outOfPeriod.add(row.po_number);
      continue;
    }
    usableRows.push(row);
  }
  for (const po of outOfPeriod) {
    const covered = usableRows.some(
      (r) => r.po_number && r.po_number.toLowerCase() === po.toLowerCase(),
    );
    if (!covered) {
      errors.push(
        `PO Number ${po} does not cover the invoice date (${invoiceDate})`,
      );
    }
  }

  const totalBalance = round2(
    usableRows.reduce((sum, r) => sum + Number(r.balance_amount), 0),
  );
  if (errors.length === 0 && totalBalance < round2(input.grandTotal)) {
    errors.push(
      `Attached PO balance (${totalBalance}) is less than the invoice grand total (${round2(input.grandTotal)})`,
    );
  }
  return { ok: errors.length === 0, errors, usableRows, totalBalance };
}

export interface PoCheckArgs {
  costCentreId: string;
  invoiceDate: string;
  grandTotal: number;
  poNumbers: string[];
}

/** Read-only (non-locking) coverage check used by create/edit and the form's live check.
 *  Approval repeats it under FOR UPDATE locks, so this is advisory against races. */
export async function checkPoCoverage(
  args: PoCheckArgs,
  executor: Pick<typeof db, "execute"> = db,
): Promise<PoCoverageResult & { poNumbers: string[] }> {
  const poNumbers = parsePoNumbers(args.poNumbers);
  assertPoNumbersShape(poNumbers);
  if (poNumbers.length === 0) {
    return { ok: true, errors: [], usableRows: [], totalBalance: 0, poNumbers };
  }
  const placeholders = poNumbers.map(() => "?").join(", ");
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT id, po_number, period_from, period_to, balance_amount, approval_status
     FROM client_po_number
     WHERE cost_centre_id = ? AND po_number IN (${placeholders})`,
    [args.costCentreId, ...poNumbers],
  );
  const result = validatePoCoverage({
    poNumbers,
    poRows: rows as PoRow[],
    invoiceDate: args.invoiceDate,
    grandTotal: args.grandTotal,
  });
  return { ...result, poNumbers };
}

/** Selectable POs for a cost centre whose period covers `invoiceDate` and that still have a balance. */
export async function listAvailablePos(
  costCentreId: string,
  invoiceDate: string,
): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, po_number, period_from, period_to, total_amount, balance_amount
     FROM client_po_number
     WHERE cost_centre_id = ? AND ? BETWEEN period_from AND period_to AND balance_amount > 0
       AND approval_status = 'approved'
     ORDER BY period_to DESC, po_number ASC
     LIMIT 200`,
    [costCentreId, invoiceDate],
  );
  return rows;
}

export interface InvoiceReferenceInput {
  poNumbers?: string[];
  grnNo?: string | null;
  grnDate?: string | null;
  jccNo?: string | null;
  jccDate?: string | null;
  rcmApplicable?: boolean;
}

export interface NormalisedReferences {
  poNumbers: string[];
  grnNo: string | null;
  grnDate: string | null;
  jccNo: string | null;
  jccDate: string | null;
  rcmApplicable: boolean;
}

function cleanText(
  value: string | null | undefined,
  max: number,
  label: string,
) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.length > max) {
    throw Object.assign(
      new Error(`${label} must be at most ${max} characters`),
      {
        statusCode: 400,
      },
    );
  }
  return v;
}

function cleanDate(value: string | null | undefined, label: string) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw Object.assign(new Error(`${label} must be a valid YYYY-MM-DD date`), {
      statusCode: 400,
    });
  }
  return v;
}

/** Validates + trims the PO/GRN/JCC/RCM block coming from a create/edit request. */
export function normaliseReferences(
  input: InvoiceReferenceInput,
): NormalisedReferences {
  const poNumbers = parsePoNumbers(input.poNumbers);
  assertPoNumbersShape(poNumbers);
  return {
    poNumbers,
    grnNo: cleanText(input.grnNo, 60, "GRN number"),
    grnDate: cleanDate(input.grnDate, "GRN date"),
    jccNo: cleanText(input.jccNo, 60, "JCC number"),
    jccDate: cleanDate(input.jccDate, "JCC date"),
    rcmApplicable: Boolean(input.rcmApplicable),
  };
}
