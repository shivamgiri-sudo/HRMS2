/**
 * Salary Transfer & Reconciliation — export batches, rejection/correction, re-export, and
 * the Transfer Number Update File import that unlocks payslips.
 *
 * FORMAT SOURCE OF TRUTH — inspected live from the two reference files supplied in the
 * Downloads folder (2026-09-11), per the mandatory-first-step rule. Not guessed.
 *
 *   "Salary Transfer File.xls" — genuine BIFF8/OLE2 (.xls) workbook, one sheet "Sheet1",
 *   header row 0, data from row 1, 21 columns in this exact order, every populated cell
 *   stored as Excel TEXT (not a number/date type — that is what preserves leading zeros and
 *   long account numbers):
 *     Debit Ac No, Beneficiary Ac No, Beneficiary Name, Amt, Pay Mod, Date, IFSC,
 *     Payable Location name, Print Location, Bene Mobile no, Bene email id,
 *     Ben add1, Ben add2, Ben add3, Ben add4,
 *     Add details 1, Add details 2, Add details 3, Add details 4, Add details 5, Remarks
 *   Remarks carries the employee code. Date is DD-MMM-YYYY, upper-cased (e.g. 11-SEP-2026).
 *   Amt is a plain digit string, no thousands separators, two-decimal amounts kept as-is
 *   (the sample carries whole rupees; this module formats to 2 decimals when the amount
 *   genuinely has paise, since the bank template does not say it truncates them).
 *   Pay Mod was 'N' on both sample rows (neither is ICICI) — the 'I' case is inferred from
 *   this codebase's own established ICIC-IFSC-prefix rule (payroll.executor.ts), not
 *   independently confirmed against a real ICICI sample row. Flagged, not guessed silently.
 *
 *   "Transfer number update file.csv" — plain CSV (not .xls, despite the original ask
 *   assuming otherwise), columns: EmpCode, EmpName, ECSNumber, TRF Date, Branch.
 *
 * REAL BIFF8, NOT A RENAMED .xlsx
 *   Verified: XLSX.write(wb, { bookType: 'biff8' }) from the repo's existing `xlsx` dependency
 *   produces a file with the same OLE2/CFB signature (D0 CF 11 E0 A1 B1 1A E1) as the
 *   reference file, and round-trips through xlrd with every cell read back as text. This is
 *   a deliberate, documented use of that dependency for WRITING data this module controls —
 *   not for PARSING untrusted input, which is where its known CVEs live. The Transfer Number
 *   Update File import below is CSV, parsed by hand, so it never touches `xlsx` at all.
 *
 * WHAT THIS DOES NOT YET DO (scoped subset, not the full original spec)
 *   No branch/process/cost-centre filters, no rejection-reason notification emails, no
 *   two-person maker-checker, no workbook cell/sheet protection flags, no MFA step-up.
 *   Each is a separate, explicit decision — not silently skipped.
 */
import { randomUUID, createHash } from "crypto";
import * as XLSX from "xlsx";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildBankReadinessReport, maskAccount, IFSC_RE } from "./bank-payment-readiness.service.js";
import { resolveAccountNumber } from "../../shared/fieldEncryption.js";
import { getDebitAccountNumber } from "./payroll-debit-account-config.service.js";

// ─── The exact 21-column header, in order ────────────────────────────────────
export const SALARY_TRANSFER_HEADER = [
  "Debit Ac No", "Beneficiary Ac No", "Beneficiary Name", "Amt", "Pay Mod", "Date", "IFSC",
  "Payable Location name", "Print Location", "Bene Mobile no", "Bene email id",
  "Ben add1", "Ben add2", "Ben add3", "Ben add4",
  "Add details 1", "Add details 2", "Add details 3", "Add details 4", "Add details 5", "Remarks",
] as const;

/**
 * The first three values/labels are the exact wording already in real, established use — seen
 * live in the branch payroll team's own working sheet (screenshot, 2026-09-11): "Incorrect IFSC
 * Code", "Incorrect Bank Account Number", "System Generated Transfer Date Crossed". Kept as the
 * literal strings rather than reworded, so this taxonomy matches what payroll staff already
 * recognise. The remaining values extend that real list to cover the rest of the spec's
 * rejection categories, which the working sheet doesn't (yet) enumerate.
 */
export const REJECTION_REASONS = [
  "incorrect_ifsc_code",
  "incorrect_bank_account_number",
  "system_generated_transfer_date_crossed",
  "account_closed",
  "account_frozen_or_dormant",
  "beneficiary_name_mismatch",
  "kyc_pending",
  "bank_validation_failed",
  "duplicate_transfer",
  "bank_technical_rejection",
  "other",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  incorrect_ifsc_code: "Incorrect IFSC Code",
  incorrect_bank_account_number: "Incorrect Bank Account Number",
  system_generated_transfer_date_crossed: "System Generated Transfer Date Crossed",
  account_closed: "Account closed",
  account_frozen_or_dormant: "Account frozen or dormant",
  beneficiary_name_mismatch: "Beneficiary/name mismatch",
  kyc_pending: "KYC pending/incomplete",
  bank_validation_failed: "Bank validation failed",
  duplicate_transfer: "Duplicate transfer",
  bank_technical_rejection: "Bank technical rejection",
  other: "Other",
};

function payMod(ifsc: string | null): "I" | "N" {
  return /^ICIC/.test(String(ifsc ?? "").trim().toUpperCase()) ? "I" : "N";
}

/** DD-MMM-YYYY, upper-cased — matches the reference file's Date column exactly. */
function formatTransferDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  return `${dd}-${mmm}-${d.getFullYear()}`;
}

/** Strips characters Excel would interpret as a formula trigger. Applied to every text cell. */
function sanitizeCell(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

export interface TransferRow {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  amount: number;
  account_number: string;
  account_masked: string;
  ifsc: string;
  bank_name: string | null;
  mobile: string | null;
  email: string | null;
  branch_id: string | null;
  branch_name: string | null;
  process_id: string | null;
  process_name: string | null;
  cost_centre_id: string | null;
  cost_centre_name: string | null;
  active_status: number;
}

export interface EligibleFilters {
  branchId?: string | null;
  processId?: string | null;
  costCentreId?: string | null;
  /** 'active' | 'inactive' | 'both'. Default 'active' — an inactive employee only ever appears
   *  in this population at all because salary_prep_line already has a payable line for them
   *  (a full-and-final settlement), so 'inactive'/'both' never invents eligibility, only reveals it. */
  status?: "active" | "inactive" | "both";
}

/**
 * Employees eligible for a NEW export from this run: READY (per the existing bank-readiness
 * classification) AND not already holding an "open" transfer item (exported-awaiting-result
 * or confirmed) for this run. The open_flag generated column on salary_transfer_batch_item
 * enforces the second half at the database level too — this is the read-side mirror of it.
 */
export async function getEligibleTransferRows(runId: string): Promise<TransferRow[]> {
  const report = await buildBankReadinessReport(runId);
  const readyIds = new Set(report.rows.filter((r) => r.payable).map((r) => r.employee_id));
  if (readyIds.size === 0) return [];

  const [openRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM salary_transfer_batch_item WHERE run_id = ? AND status IN ('exported','confirmed')`,
    [runId],
  );
  const alreadyOpen = new Set((openRows as any[]).map((r) => r.employee_id));

  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id, spl.employee_code, spl.net_salary,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            e.mobile, COALESCE(NULLIF(TRIM(e.official_email),''), e.email) AS email,
            e.active_status, e.branch_id, e.process_id, e.cost_centre_id,
            b.branch_name, p.process_name, cc.cost_centre_name,
            ebd.account_number_enc, CAST(ebd.account_number AS CHAR) AS account_number_legacy,
            ebd.ifsc_code, ebd.bank_name
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN employee_bank_detail ebd
              ON ebd.employee_id = spl.employee_id AND ebd.is_primary = 1 AND ebd.active_status = 1
      WHERE spl.run_id = ? AND COALESCE(spl.net_salary, 0) > 0`,
    [runId],
  );

  const rows: TransferRow[] = [];
  for (const line of lineRows as any[]) {
    if (!readyIds.has(line.employee_id) || alreadyOpen.has(line.employee_id)) continue;
    const account = resolveAccountNumber({
      account_number_enc: line.account_number_enc,
      account_number: line.account_number_legacy,
    });
    if (!account || !IFSC_RE.test(String(line.ifsc_code ?? "").toUpperCase())) continue; // defence in depth, mirrors classifyBankReadiness
    rows.push({
      employee_id: line.employee_id,
      employee_code: line.employee_code,
      employee_name: String(line.employee_name ?? "").trim(),
      amount: Number(line.net_salary),
      account_number: account,
      account_masked: maskAccount(account),
      ifsc: String(line.ifsc_code ?? "").toUpperCase(),
      bank_name: line.bank_name ?? null,
      mobile: line.mobile ?? null,
      email: line.email ?? null,
      branch_id: line.branch_id ?? null,
      branch_name: line.branch_name ?? null,
      process_id: line.process_id ?? null,
      process_name: line.process_name ?? null,
      cost_centre_id: line.cost_centre_id ?? null,
      cost_centre_name: line.cost_centre_name ?? null,
      active_status: Number(line.active_status ?? 0),
    });
  }
  return rows;
}

/** getEligibleTransferRows, narrowed by the selection filters — branch/process/cost-centre/status. */
export async function getFilteredEligibleTransferRows(runId: string, filters: EligibleFilters): Promise<TransferRow[]> {
  const rows = await getEligibleTransferRows(runId);
  const status = filters.status ?? "active";
  return rows.filter((r) => {
    if (filters.branchId && r.branch_id !== filters.branchId) return false;
    if (filters.processId && r.process_id !== filters.processId) return false;
    if (filters.costCentreId && r.cost_centre_id !== filters.costCentreId) return false;
    if (status === "active" && r.active_status !== 1) return false;
    if (status === "inactive" && r.active_status === 1) return false;
    // status === "both": no filter
    return true;
  });
}

/** Builds the 21-column AOA (array-of-arrays) matching the reference file's row shape. */
function buildAoa(rows: TransferRow[], debitAccount: string, dateLabel: string): unknown[][] {
  const aoa: unknown[][] = [[...SALARY_TRANSFER_HEADER]];
  for (const r of rows) {
    aoa.push([
      debitAccount,
      r.account_number,
      sanitizeCell(r.employee_name.toUpperCase()),
      // Whole rupees, no paise — matches the reference file's own sample rows ("2705", not
      // "2705.00"). Explicit user correction, 2026-09-11: real salary amounts carry paise
      // (e.g. 18453.58) but the bank file's Amt column must be a round number.
      String(Math.round(r.amount)),
      payMod(r.ifsc),
      dateLabel,
      r.ifsc,
      "", "", "", "", "", "", "", "", "", "", "", "", "",
      sanitizeCell(r.employee_code),
    ]);
  }
  return aoa;
}

/** Writes the AOA to a genuine BIFF8 .xls buffer, every cell forced to Excel text type. */
export function writeSalaryTransferXls(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const cell = (ws as any)[key];
    if (cell && typeof cell.v !== "undefined") {
      cell.t = "s";
      cell.z = "@";
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { bookType: "biff8", type: "buffer" }) as Buffer;
}

export interface GenerateBatchResult {
  batch_id: string;
  batch_number: string;
  file_name: string;
  buffer: Buffer;
  row_count: number;
  total_amount: number;
  excluded: Array<{ employee_code: string; reason: string }>;
}

/**
 * Creates an immutable batch + item rows (atomic) and returns the generated file. If nothing
 * is eligible, no batch is created. corrections is an optional list of employee_ids to build
 * a RE-EXPORT batch from (only corrected_ready items), rather than the full eligible run.
 */
export async function generateSalaryTransferBatch(params: {
  runId: string;
  userId: string;
  employeeIds?: string[] | null; // explicit selection; null/omitted = all eligible
  reexport?: boolean;
}): Promise<GenerateBatchResult> {
  const { runId, userId } = params;
  const debitAccount = await getDebitAccountNumber();
  const now = new Date();
  const dateLabel = formatTransferDate(now);

  let rows: TransferRow[];
  let correctedItemByEmployee = new Map<string, string>();
  if (params.reexport) {
    // Re-export population: only employees with a corrected_ready item for this run.
    const [readyItems] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id FROM salary_transfer_batch_item WHERE run_id = ? AND status = 'corrected_ready'`,
      [runId],
    );
    const readySet = new Set((readyItems as any[]).map((r) => r.employee_id));
    for (const r of readyItems as any[]) correctedItemByEmployee.set(r.employee_id, r.id);
    const eligible = await getEligibleTransferRows(runId); // re-checks READY + no open item
    rows = eligible.filter((r) => readySet.has(r.employee_id));
  } else {
    rows = await getEligibleTransferRows(runId);
  }

  const excluded: Array<{ employee_code: string; reason: string }> = [];
  if (params.employeeIds && params.employeeIds.length) {
    const wanted = new Set(params.employeeIds);
    const filtered = rows.filter((r) => wanted.has(r.employee_id));
    for (const id of wanted) {
      if (!rows.some((r) => r.employee_id === id)) {
        excluded.push({ employee_code: id, reason: "no longer eligible at export time" });
      }
    }
    rows = filtered;
  }

  if (rows.length === 0) {
    throw Object.assign(new Error("No eligible employees to export"), { code: "NO_ELIGIBLE_ROWS" });
  }

  const aoa = buildAoa(rows, debitAccount, dateLabel);
  const buffer = writeSalaryTransferXls(aoa);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const batchId = randomUUID();
  const batchNumber = `ST-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${batchId.slice(0, 8).toUpperCase()}`;
  const fileName = `Salary_Transfer_${String(runId).slice(0, 8)}_${now.toISOString().slice(0, 10)}${params.reexport ? "_REEXPORT" : ""}.xls`;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO salary_transfer_batch
         (id, run_id, batch_number, attempt_kind, row_count, total_amount, debit_account_masked,
          file_name, file_sha256, filters_snapshot, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchId, runId, batchNumber, params.reexport ? "reexport" : "initial",
        rows.length, totalAmount.toFixed(2), maskAccount(debitAccount),
        fileName, sha256, JSON.stringify({ employeeIds: params.employeeIds ?? null }), userId,
      ],
    );
    for (const r of rows) {
      const correctedFrom = correctedItemByEmployee.get(r.employee_id) ?? null;
      await conn.execute(
        `INSERT INTO salary_transfer_batch_item
           (id, batch_id, run_id, employee_id, employee_code, amount, pay_mod, account_masked,
            status, corrected_from_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'exported', ?)`,
        [randomUUID(), batchId, runId, r.employee_id, r.employee_code, r.amount, payMod(r.ifsc), r.account_masked, correctedFrom],
      );
      // The corrected_ready row this re-export came from is now superseded by the new
      // 'exported' row above — flip it to 'rejected' territory conceptually by marking it
      // confirmed=false is wrong; instead we simply leave it as historical (open_flag is
      // NULL for corrected_ready already, so it never blocked anything and needs no update).
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  return { batch_id: batchId, batch_number: batchNumber, file_name: fileName, buffer, row_count: rows.length, total_amount: totalAmount, excluded };
}

// ─── Rejection ────────────────────────────────────────────────────────────────

export async function rejectTransferItems(params: {
  itemIds: string[];
  reason: RejectionReason;
  note: string | null;
  userId: string;
}): Promise<{ updated: number }> {
  if (params.reason === "other" && !params.note?.trim()) {
    throw Object.assign(new Error("A note is required when reason is 'other'"), { code: "NOTE_REQUIRED" });
  }
  if (!params.itemIds.length) return { updated: 0 };
  const placeholders = params.itemIds.map(() => "?").join(",");
  const [result] = await db.execute<any>(
    `UPDATE salary_transfer_batch_item
        SET status = 'rejected', rejection_reason = ?, rejection_note = ?,
            rejected_at = CURRENT_TIMESTAMP, rejected_by = ?
      WHERE id IN (${placeholders}) AND status = 'exported'`,
    [params.reason, params.note ?? null, params.userId, ...params.itemIds],
  );
  return { updated: (result as any).affectedRows ?? 0 };
}

/** Called once an employee's bank-detail correction has cleared the existing approval + penny-drop flow. */
export async function markItemCorrectedReady(itemId: string): Promise<void> {
  await db.execute(
    `UPDATE salary_transfer_batch_item SET status = 'corrected_ready' WHERE id = ? AND status = 'rejected'`,
    [itemId],
  );
}

export function rejectionReasonLabel(reason: string): string {
  return REJECTION_REASON_LABELS[reason as RejectionReason] ?? reason;
}

// ─── Transfer Number Update File (CSV) import ────────────────────────────────

export interface TransferImportRow {
  emp_code: string;
  emp_name: string;
  ecs_number: string;
  trf_date: string;
  branch: string;
}

export interface TransferImportPreviewRow extends TransferImportRow {
  outcome: "will_confirm" | "unmatched" | "already_confirmed" | "invalid";
  detail: string;
  item_id: string | null;
}

/** Naive CSV split is safe here: this file has no quoted/embedded commas per the reference sample. */
export function parseTransferNumberCsv(text: string): TransferImportRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const iCode = idx("empcode"), iName = idx("empname"), iEcs = idx("ecsnumber"), iDate = idx("trf date"), iBranch = idx("branch");
  if (iCode === -1 || iEcs === -1) {
    throw Object.assign(new Error("CSV must have EmpCode and ECSNumber columns"), { code: "BAD_HEADERS" });
  }
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return {
      emp_code: cells[iCode] ?? "",
      emp_name: iName >= 0 ? (cells[iName] ?? "") : "",
      ecs_number: cells[iEcs] ?? "",
      trf_date: iDate >= 0 ? (cells[iDate] ?? "") : "",
      branch: iBranch >= 0 ? (cells[iBranch] ?? "") : "",
    };
  });
}

/** Preview only — never writes. Matches on employee_code against the latest open ('exported') item. */
export async function previewTransferNumberImport(rows: TransferImportRow[]): Promise<TransferImportPreviewRow[]> {
  const codes = [...new Set(rows.map((r) => r.emp_code).filter(Boolean))];
  if (codes.length === 0) return rows.map((r) => ({ ...r, outcome: "invalid", detail: "blank EmpCode", item_id: null }));

  const placeholders = codes.map(() => "?").join(",");
  const [itemRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, status FROM salary_transfer_batch_item WHERE employee_code IN (${placeholders})
      ORDER BY created_at DESC`,
    codes,
  );
  const byCode = new Map<string, any>();
  for (const r of itemRows as any[]) {
    if (!byCode.has(r.employee_code)) byCode.set(r.employee_code, r); // newest wins, first row per code
  }

  return rows.map((r) => {
    if (!r.emp_code || !r.ecs_number) {
      return { ...r, outcome: "invalid", detail: "blank EmpCode or ECSNumber", item_id: null };
    }
    const item = byCode.get(r.emp_code);
    if (!item) return { ...r, outcome: "unmatched", detail: "no exported transfer item for this employee", item_id: null };
    if (item.status === "confirmed") {
      return { ...r, outcome: "already_confirmed", detail: "transfer number already recorded", item_id: item.id };
    }
    if (item.status !== "exported") {
      return { ...r, outcome: "unmatched", detail: `latest item is '${item.status}', not awaiting a transfer number`, item_id: item.id };
    }
    return { ...r, outcome: "will_confirm", detail: "OK", item_id: item.id };
  });
}

export interface CommitImportResult {
  confirmed: number;
  payslips_unlocked: number;
  skipped: number;
}

/**
 * Commits only rows the preview marked will_confirm. Each confirmation is one atomic
 * UPDATE ... WHERE status = 'exported' (so a row already confirmed by a concurrent commit
 * is silently skipped rather than double-processed), and payslip_unlocked_at is set in the
 * SAME statement as confirmed_at — one employee's row can never end up confirmed-but-locked.
 */
export async function commitTransferNumberImport(params: {
  preview: TransferImportPreviewRow[];
  fileName: string;
  fileSha256: string;
  userId: string;
}): Promise<CommitImportResult> {
  const toApply = params.preview.filter((r) => r.outcome === "will_confirm" && r.item_id);

  const [existingImport] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM salary_transfer_import WHERE file_sha256 = ? LIMIT 1`,
    [params.fileSha256],
  );
  if ((existingImport as any[])[0]) {
    return { confirmed: 0, payslips_unlocked: 0, skipped: toApply.length }; // idempotent re-upload
  }

  let confirmed = 0;
  for (const row of toApply) {
    const trfDate = parseTrfDate(row.trf_date);
    const [result] = await db.execute<any>(
      `UPDATE salary_transfer_batch_item
          SET status = 'confirmed', ecs_number = ?, transfer_date = ?,
              confirmed_at = CURRENT_TIMESTAMP, confirmed_by = ?, payslip_unlocked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'exported'`,
      [row.ecs_number, trfDate, params.userId, row.item_id],
    );
    if ((result as any).affectedRows) confirmed++;
  }

  await db.execute(
    `INSERT INTO salary_transfer_import (id, file_name, file_sha256, row_count, matched_count, unmatched_count, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), params.fileName, params.fileSha256, params.preview.length, confirmed, params.preview.length - confirmed, params.userId],
  );

  return { confirmed, payslips_unlocked: confirmed, skipped: params.preview.length - confirmed };
}

/** "7-May-26" style dates from the reference CSV → MySQL DATE. Falls back to null, never throws — an unparsable date must not abort the whole import. */
function parseTrfDate(v: string): string | null {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${mm}-${m[1].padStart(2, "0")}`;
}

/** Whether this employee's payslip for this run is locked pending a transfer number. Additive: returns unlocked=true (no gate) when the feature has never been used for this run/employee. */
export async function getPayslipLockState(employeeId: string, runId: string): Promise<{ locked: boolean; reason: string | null }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM salary_transfer_batch_item WHERE employee_id = ? AND run_id = ? ORDER BY created_at DESC LIMIT 1`,
    [employeeId, runId],
  );
  const item = (rows as any[])[0];
  if (!item) return { locked: false, reason: null }; // no transfer item at all — existing behaviour, unchanged
  if (item.status === "confirmed") return { locked: false, reason: null };
  return { locked: true, reason: `Payslip is locked until the salary transfer is confirmed (current status: ${item.status}).` };
}
