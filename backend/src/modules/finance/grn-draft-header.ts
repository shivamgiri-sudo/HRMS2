import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

/**
 * Header edits on a DRAFT GRN (vendor, bill date, due date / payment terms, remarks).
 *
 * The create call is the only one that ever wrote these columns, and the form only creates on
 * the first save — so re-opening a draft and changing its vendor or due date "saved" without
 * error while the change was silently dropped. The invoice-components / allocations saves now
 * carry the header too and apply it through here, inside their own transaction and only after
 * they have confirmed the GRN is still a draft.
 *
 * Same rules the create applies: an active Vendor Master vendor, a YYYY-MM-DD bill date,
 * payment terms a whole number of days 0-365, due date = bill date + terms. Fields the caller
 * omits are left exactly as they are.
 */
export interface DraftHeaderInput {
  vendorId?: string | null;
  billDate?: string | null;
  /** YYYY-MM-DD. When present it decides payment_terms_days (days after the bill date). */
  dueDate?: string | null;
  paymentTermsDays?: number | null;
  /** A string (even empty) replaces the remarks; undefined/null leaves them alone. */
  remarks?: string | null;
  /** An explicit accounting-month override — when present the bill date never re-derives it. */
  accountingPeriod?: string | null;
}

type GrnRow = Record<string, any>;

export type DraftHeaderPlan = {
  /** Column -> new value, only for columns that actually change. Never includes vendor_name. */
  set: Record<string, string | number | null>;
  /** Vendor id to verify (active, in Vendor Master) before it is written; null = unchanged. */
  vendorIdToVerify: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function isRealDate(value: string) {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000
  );
}

function financialYearOf(periodCode: string) {
  const [year, month] = periodCode.split("-").map(Number);
  return month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
}

function assertTerms(days: number) {
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw new Error("Payment terms must be a whole number between 0 and 365 days");
  }
}

/** Pure: what the header update would change. Throws on an invalid value. */
export function planDraftHeaderEdit(grn: GrnRow, input: DraftHeaderInput): DraftHeaderPlan {
  const set: DraftHeaderPlan["set"] = {};
  const isVendor = String(grn.grn_type) === "vendor";

  const oldBill = dateOnly(grn.bill_date);
  let bill = oldBill;
  const requestedBill = String(input.billDate ?? "").trim();
  if (requestedBill) {
    if (!isRealDate(requestedBill)) throw new Error("A valid bill/receipt date is required");
    bill = requestedBill;
  }
  if (bill !== oldBill) {
    set.bill_date = bill;
    // The accounting month follows the bill date unless someone deliberately booked it elsewhere
    // (a stored period that differs from the old bill month, or an override on this request).
    const oldPeriod = String(grn.accounting_period ?? "").trim();
    const explicitOverride = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.accountingPeriod ?? "").trim());
    const derived = !oldPeriod || oldPeriod === oldBill.slice(0, 7);
    if (!explicitOverride && derived && bill.slice(0, 7) !== oldPeriod) {
      set.accounting_period = bill.slice(0, 7);
      set.financial_year = financialYearOf(bill.slice(0, 7));
    }
  }

  const oldTerms = Number(grn.payment_terms_days ?? 0);
  let terms = oldTerms;
  if (isVendor) {
    const requestedDue = String(input.dueDate ?? "").trim();
    if (requestedDue) {
      if (!isRealDate(requestedDue)) throw new Error("Due date must be a valid date");
      terms = daysBetween(bill, requestedDue);
      if (terms < 0) throw new Error("Due date cannot fall before the invoice date.");
      if (terms > 365) throw new Error("Due date must be within 365 days of the invoice date.");
    } else if (input.paymentTermsDays != null && String(input.paymentTermsDays) !== "") {
      terms = Number(input.paymentTermsDays);
      assertTerms(terms);
    }
  }
  if (terms !== oldTerms) set.payment_terms_days = terms;
  // Only re-stated when the bill date or the terms moved — a save that carries neither leaves
  // whatever due date is on file alone.
  if (bill && (bill !== oldBill || terms !== oldTerms)) {
    const due = addDays(bill, terms);
    if (due !== dateOnly(grn.due_date)) set.due_date = due;
  }

  if (typeof input.remarks === "string") {
    const remarks = input.remarks.trim() || null;
    if (remarks !== (grn.remarks ?? null)) set.remarks = remarks;
  }

  const requestedVendor = String(input.vendorId ?? "").trim();
  const vendorIdToVerify =
    isVendor && requestedVendor && requestedVendor !== String(grn.vendor_id ?? "") ? requestedVendor : null;

  return { set, vendorIdToVerify };
}

const UPDATABLE_COLUMNS = new Set([
  "vendor_id", "vendor_name", "bill_date", "accounting_period", "financial_year",
  "payment_terms_days", "due_date", "remarks",
]);

/**
 * Applies the plan on the caller's transaction. The caller must hold the GRN row lock and have
 * checked status = 'draft'; the UPDATE re-checks the status anyway. Returns the before/after
 * of every changed column (for the audit log) — empty when nothing changed.
 */
export async function applyDraftHeaderEdit(
  connection: PoolConnection,
  grn: GrnRow,
  input: DraftHeaderInput
): Promise<{ set: Record<string, string | number | null>; changes: Record<string, { from: unknown; to: unknown }> }> {
  const plan = planDraftHeaderEdit(grn, input);
  const set = { ...plan.set };
  if (plan.vendorIdToVerify) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id, vendor_name, is_active FROM vendor_master WHERE id = ? LIMIT 1",
      [plan.vendorIdToVerify]
    );
    const vendor = rows[0];
    if (!vendor) throw new Error("Selected vendor was not found in Vendor Master");
    if (Number(vendor.is_active ?? 0) !== 1) {
      throw new Error("Selected vendor is inactive and cannot be used for a GRN");
    }
    set.vendor_id = String(vendor.id);
    set.vendor_name = String(vendor.vendor_name);
  }

  const columns = Object.keys(set).filter((column) => UPDATABLE_COLUMNS.has(column));
  if (!columns.length) return { set: {}, changes: {} };
  await connection.execute(
    `UPDATE grn_request SET ${columns.map((column) => `${column} = ?`).join(", ")}
      WHERE id = ? AND status = 'draft'`,
    [...columns.map((column) => set[column]), grn.id]
  );
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const column of columns) changes[column] = { from: grn[column] ?? null, to: set[column] };
  return { set, changes };
}
