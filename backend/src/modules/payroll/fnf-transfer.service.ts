/**
 * Full & Final settlement disbursement — a bank-transfer batch of its own.
 *
 * Owner ruling 2026-09-12:
 *   Q6: "The final settlement gets its own bank transfer batch, separate from monthly salary,
 *       but using the same bank-file machinery and approvals."
 *   Q7: "A leaver without a signed NOC must not appear in the bank file."
 *
 * BEFORE THIS FILE
 *   full_final_calculation could reach status='approved' and even 'paid' (via ff.service.ts's
 *   markFfPaid) with the "payment" being nothing more than a typed-in reference string. No
 *   bank file was ever generated for a settlement; no NOC check ran anywhere in that path;
 *   payroll-governance.service.ts's own audit describes the whole exit_request →
 *   full_final_calculation workflow as essentially unused in production, in part because there
 *   was nowhere for it to actually go.
 *
 * WHY A SEPARATE LEDGER, NOT THE SALARY ONE
 *   See 1762_fnf_transfer_batch.sql's header: salary_transfer_batch_item's dedup constraint is
 *   keyed on (run_id, employee_id), and F&F has no run_id — it is one row per exit_request, not
 *   per monthly payroll run. Reusing that table would mean inventing a run_id with no meaning,
 *   or weakening the constraint that protects real salary disbursement. fnf_transfer_batch /
 *   fnf_transfer_batch_item mirror the same shape, same open_flag generated-column trick, keyed
 *   on full_final_calculation_id instead.
 *
 * WHY NOC IS MANDATORY HERE AND NOT GATED BY THE SALARY KILL SWITCH
 *   noc_salary_release_gate_enabled (noc-release-gate.service.ts) exists because the salary
 *   population is mostly ACTIVE employees where NOC never applies, plus a minority of leavers
 *   still carrying a payable line — a kill switch matters there because turning it off cannot
 *   be mistaken for "leavers don't need a NOC." Every row this module ever handles IS a leaver,
 *   by construction (full_final_calculation.employee_id only exists because they exited), so
 *   there is no equivalent "mostly doesn't apply" population to protect against a
 *   misconfigured flag. The gate here is unconditional: nocReleaseStatusForEmployee(...).blocked
 *   must be false before a settlement is eligible, full stop.
 *
 * WHAT IS REUSED FROM salary-transfer.service.ts, VERBATIM
 *   buildAoa / writeSalaryTransferXls / SALARY_TRANSFER_HEADER / formatTransferDate /
 *   parseTransferNumberCsv / parseTrfDate — the bank's file format and the bank's own CSV
 *   response format are properties of the BANK, not of which disbursement type is being paid.
 *   getDebitAccountNumber() — one company-wide debit account, shared with salary; F&F does not
 *   need or get its own config row unless finance later says otherwise.
 *   employee_bank_detail resolution (is_primary=1, active_status=1) + resolveAccountNumber() +
 *   IFSC_RE — identical account-resolution rule as salary.
 */
import { randomUUID, createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveAccountNumber } from "../../shared/fieldEncryption.js";
import { IFSC_RE, maskAccount } from "./bank-payment-readiness.service.js";
import { getDebitAccountNumber } from "./payroll-debit-account-config.service.js";
import { nocReleaseStatusForEmployee } from "./noc-release-gate.service.js";
import {
  SALARY_TRANSFER_HEADER,
  buildAoa,
  formatTransferDate,
  writeSalaryTransferXls,
  parseTransferNumberCsv,
  parseTrfDate,
  type TransferImportRow,
  type TransferImportPreviewRow,
} from "./salary-transfer.service.js";
import { ffService } from "../exit/ff.service.js";

// Re-exported so a route file needs only this module for the whole F&F-transfer surface,
// rather than importing CSV helpers from salary-transfer.service.ts directly.
export { SALARY_TRANSFER_HEADER, parseTransferNumberCsv };
export type { TransferImportRow, TransferImportPreviewRow };

export interface FnfTransferRow {
  full_final_calculation_id: string;
  exit_request_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  amount: number;
  account_number: string;
  account_masked: string;
  ifsc: string;
  bank_name: string | null;
}

export interface FnfIneligible {
  full_final_calculation_id: string;
  exit_request_id: string;
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  reason: string;
}

/**
 * Every approved, not-yet-open-transferred F&F settlement, split into what can be paid and why
 * the rest cannot — never a silent drop. Mirrors getEligibleTransferRowsWithNocExclusions'
 * "report the exclusion" contract for the identical reason: a payable settlement missing from
 * the bank file with no explanation is the exact failure this whole feature exists to prevent.
 *
 * Eligibility, all three required:
 *   1. full_final_calculation.status = 'approved' AND is_ff_provisional = 0 — draft/verified
 *      settlements are not final, and a provisional one rests on unconfirmed statutory
 *      config; ff.service.ts's own approveFF already refuses to approve while provisional, so
 *      this is a second, independent check rather than trusting that gate never regresses.
 *   2. NOC cleared — nocReleaseStatusForEmployee(...).blocked === false. Mandatory; see the
 *      file header for why this is not behind the salary kill switch.
 *   3. Not already holding an open transfer item (exported-awaiting-result or confirmed).
 *      Same generated-column enforcement at the DB level as salary_transfer_batch_item.
 */
export async function getEligibleFnfTransferRows(): Promise<{
  rows: FnfTransferRow[];
  ineligible: FnfIneligible[];
}> {
  const [ffRows] = await db.execute<RowDataPacket[]>(
    `SELECT ff.id AS full_final_calculation_id, ff.exit_request_id, ff.employee_id, ff.net_payable,
            e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            ebd.account_number_enc, CAST(ebd.account_number AS CHAR) AS account_number_legacy,
            ebd.ifsc_code, ebd.bank_name
       FROM full_final_calculation ff
       JOIN employees e ON e.id = ff.employee_id
       LEFT JOIN employee_bank_detail ebd
              ON ebd.employee_id = ff.employee_id AND ebd.is_primary = 1 AND ebd.active_status = 1
      WHERE ff.status = 'approved' AND ff.is_ff_provisional = 0
        AND COALESCE(ff.net_payable, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM fnf_transfer_batch_item i
           WHERE i.full_final_calculation_id = ff.id AND i.status IN ('exported','confirmed')
        )`,
  );

  const rows: FnfTransferRow[] = [];
  const ineligible: FnfIneligible[] = [];

  for (const line of ffRows as any[]) {
    const base = {
      full_final_calculation_id: line.full_final_calculation_id,
      exit_request_id: line.exit_request_id,
      employee_id: line.employee_id,
      employee_code: line.employee_code ?? null,
      employee_name: (line.employee_name ?? "").trim() || null,
    };

    // NOC — mandatory, unconditional. See file header.
    const noc = await nocReleaseStatusForEmployee(line.employee_id);
    if (noc.blocked) {
      ineligible.push({ ...base, reason: noc.reason ?? "NOC clearance is not complete" });
      continue;
    }

    const account = resolveAccountNumber({
      account_number_enc: line.account_number_enc,
      account_number: line.account_number_legacy,
    });
    if (!account) {
      ineligible.push({ ...base, reason: "No active primary bank account on file" });
      continue;
    }
    const ifsc = String(line.ifsc_code ?? "").toUpperCase();
    if (!IFSC_RE.test(ifsc)) {
      ineligible.push({ ...base, reason: "IFSC code is missing or invalid" });
      continue;
    }

    rows.push({
      full_final_calculation_id: base.full_final_calculation_id,
      exit_request_id: base.exit_request_id,
      employee_id: base.employee_id,
      employee_code: base.employee_code ?? "",
      employee_name: base.employee_name ?? "",
      amount: Number(line.net_payable),
      account_number: account,
      account_masked: maskAccount(account),
      ifsc,
      bank_name: line.bank_name ?? null,
    });
  }

  return { rows, ineligible };
}

export interface GenerateFnfBatchResult {
  batch_id: string;
  batch_number: string;
  file_name: string;
  buffer: Buffer;
  row_count: number;
  total_amount: number;
  excluded: Array<{ full_final_calculation_id: string; reason: string }>;
}

/**
 * Creates an immutable batch + item rows (atomic) and returns the generated bank file.
 * Structurally identical to generateSalaryTransferBatch — same debit-account lookup, same
 * AOA/BIFF8 writer, same transaction shape — differing only in the eligibility source (F&F
 * settlements, not a payroll run) and the table it writes to.
 */
export async function generateFnfTransferBatch(params: {
  userId: string;
  fullFinalCalculationIds?: string[] | null; // explicit selection; null/omitted = all eligible
}): Promise<GenerateFnfBatchResult> {
  const debitAccount = await getDebitAccountNumber();
  const now = new Date();
  const dateLabel = formatTransferDate(now);

  const { rows: eligible } = await getEligibleFnfTransferRows();

  const excluded: Array<{ full_final_calculation_id: string; reason: string }> = [];
  let rows = eligible;
  if (params.fullFinalCalculationIds && params.fullFinalCalculationIds.length) {
    const wanted = new Set(params.fullFinalCalculationIds);
    rows = eligible.filter((r) => wanted.has(r.full_final_calculation_id));
    for (const id of wanted) {
      if (!eligible.some((r) => r.full_final_calculation_id === id)) {
        excluded.push({ full_final_calculation_id: id, reason: "no longer eligible at export time" });
      }
    }
  }

  if (rows.length === 0) {
    throw Object.assign(new Error("No eligible F&F settlements to export"), { code: "NO_ELIGIBLE_ROWS" });
  }

  const aoa = buildAoa(rows, debitAccount, dateLabel);
  const buffer = writeSalaryTransferXls(aoa);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const batchId = randomUUID();
  const batchNumber = `FF-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${batchId.slice(0, 8).toUpperCase()}`;
  const fileName = `FnF_Transfer_${now.toISOString().slice(0, 10)}.xls`;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO fnf_transfer_batch
         (id, batch_number, attempt_kind, row_count, total_amount, debit_account_masked,
          file_name, file_sha256, filters_snapshot, created_by)
       VALUES (?, ?, 'initial', ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchId, batchNumber, rows.length, totalAmount.toFixed(2), maskAccount(debitAccount),
        fileName, sha256, JSON.stringify({ fullFinalCalculationIds: params.fullFinalCalculationIds ?? null }),
        params.userId,
      ],
    );
    for (const r of rows) {
      await conn.execute(
        `INSERT INTO fnf_transfer_batch_item
           (id, batch_id, full_final_calculation_id, exit_request_id, employee_id, employee_code,
            amount, pay_mod, account_masked, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'exported')`,
        [
          randomUUID(), batchId, r.full_final_calculation_id, r.exit_request_id, r.employee_id,
          r.employee_code, r.amount.toFixed(2), /^ICIC/.test(r.ifsc) ? "I" : "N", r.account_masked,
        ],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { batch_id: batchId, batch_number: batchNumber, file_name: fileName, buffer, row_count: rows.length, total_amount: totalAmount, excluded };
}

/** Same rejection/correction shape as salary_transfer_batch_item — see salary-transfer.service.ts. */
export async function rejectFnfTransferItems(params: {
  itemIds: string[];
  reason: string;
  note?: string | null;
  userId: string;
}): Promise<{ updated: number }> {
  if (!params.itemIds.length) return { updated: 0 };
  const placeholders = params.itemIds.map(() => "?").join(",");
  const [result] = await db.execute<any>(
    `UPDATE fnf_transfer_batch_item
        SET status = 'rejected', rejection_reason = ?, rejection_note = ?,
            rejected_at = CURRENT_TIMESTAMP, rejected_by = ?
      WHERE id IN (${placeholders}) AND status = 'exported'`,
    [params.reason, params.note ?? null, params.userId, ...params.itemIds],
  );
  return { updated: (result as any).affectedRows ?? 0 };
}

export async function markFnfItemCorrectedReady(itemId: string): Promise<void> {
  await db.execute(
    `UPDATE fnf_transfer_batch_item SET status = 'corrected_ready' WHERE id = ? AND status = 'rejected'`,
    [itemId],
  );
}

export interface FnfTransferImportPreviewRow extends TransferImportRow {
  outcome: "will_confirm" | "unmatched" | "already_confirmed" | "invalid";
  detail: string;
  item_id: string | null;
  full_final_calculation_id: string | null;
}

/**
 * Preview only — never writes. Matches on employee_code against the latest open ('exported')
 * fnf_transfer_batch_item, across ALL batches (unlike salary's run-scoped match, F&F has no
 * run to scope by — full_final_calculation_id is already the uniqueness boundary, enforced by
 * open_flag, so at most one 'exported' item can exist per settlement at any time).
 */
export async function previewFnfTransferNumberImport(rows: TransferImportRow[]): Promise<FnfTransferImportPreviewRow[]> {
  const codes = [...new Set(rows.map((r) => r.emp_code).filter(Boolean))];
  if (codes.length === 0) {
    return rows.map((r) => ({ ...r, outcome: "invalid", detail: "blank EmpCode", item_id: null, full_final_calculation_id: null }));
  }

  const placeholders = codes.map(() => "?").join(",");
  const [itemRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, status, full_final_calculation_id
       FROM fnf_transfer_batch_item WHERE employee_code IN (${placeholders})
      ORDER BY created_at DESC`,
    codes,
  );
  const byCode = new Map<string, any>();
  for (const r of itemRows as any[]) {
    if (!byCode.has(r.employee_code)) byCode.set(r.employee_code, r); // newest wins, first row per code
  }

  return rows.map((r) => {
    if (!r.emp_code || !r.ecs_number) {
      return { ...r, outcome: "invalid", detail: "blank EmpCode or ECSNumber", item_id: null, full_final_calculation_id: null };
    }
    const item = byCode.get(r.emp_code);
    if (!item) {
      return { ...r, outcome: "unmatched", detail: "no exported F&F transfer item for this employee", item_id: null, full_final_calculation_id: null };
    }
    if (item.status === "confirmed") {
      return { ...r, outcome: "already_confirmed", detail: "transfer number already recorded", item_id: item.id, full_final_calculation_id: item.full_final_calculation_id };
    }
    if (item.status !== "exported") {
      return { ...r, outcome: "unmatched", detail: `latest item is '${item.status}', not awaiting a transfer number`, item_id: item.id, full_final_calculation_id: item.full_final_calculation_id };
    }
    return { ...r, outcome: "will_confirm", detail: "OK", item_id: item.id, full_final_calculation_id: item.full_final_calculation_id };
  });
}

export interface CommitFnfImportResult {
  confirmed: number;
  ff_marked_paid: number;
  ff_mark_paid_failures: Array<{ full_final_calculation_id: string; error: string }>;
  skipped: number;
}

/**
 * Commits only rows the preview marked will_confirm, THEN calls ffService.markFfPaid for each
 * confirmed settlement — this is the one step that actually closes the loop this whole feature
 * exists for: full_final_calculation had a 'paid' status and a maker-checker guard
 * (ff.service.ts's markFfPaid) with nothing behind it. Confirming the bank transfer is now what
 * drives that status change, instead of a free-text assertion typed in with no bank evidence.
 *
 * markFfPaid enforces its own rules independently (approved-only, non-empty reference,
 * approver != payer) — this function does not duplicate or weaken them. The transfer's own
 * ecs_number becomes the payment reference passed to markFfPaid, so the settlement's audit
 * trail names the actual bank transaction rather than a value someone typed by hand.
 *
 * A markFfPaid failure (e.g. the maker-checker guard refusing because the confirming user also
 * approved the settlement) does NOT roll back the transfer confirmation: the money has left the
 * bank account regardless of who is allowed to record it in this system, so the transfer
 * status must reflect reality. The failure is collected and returned, not swallowed, so the
 * settlement's status can be reconciled by hand rather than silently staying 'approved' while
 * the bank shows it paid.
 */
export async function commitFnfTransferNumberImport(params: {
  preview: FnfTransferImportPreviewRow[];
  fileName: string;
  fileSha256: string;
  userId: string;
}): Promise<CommitFnfImportResult> {
  const toApply = params.preview.filter((r) => r.outcome === "will_confirm" && r.item_id);

  const [existingImport] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM fnf_transfer_import WHERE file_sha256 = ? LIMIT 1`,
    [params.fileSha256],
  );
  if ((existingImport as any[])[0]) {
    return { confirmed: 0, ff_marked_paid: 0, ff_mark_paid_failures: [], skipped: toApply.length }; // idempotent re-upload
  }

  let confirmed = 0;
  let ffMarkedPaid = 0;
  const ffFailures: Array<{ full_final_calculation_id: string; error: string }> = [];

  for (const row of toApply) {
    const trfDate = parseTrfDate(row.trf_date);
    const [result] = await db.execute<any>(
      `UPDATE fnf_transfer_batch_item
          SET status = 'confirmed', ecs_number = ?, transfer_date = ?, confirmed_at = CURRENT_TIMESTAMP, confirmed_by = ?
        WHERE id = ? AND status = 'exported'`,
      [row.ecs_number, trfDate, params.userId, row.item_id],
    );
    if (!(result as any).affectedRows) continue;
    confirmed++;

    if (row.full_final_calculation_id) {
      try {
        await ffService.markFfPaid(row.full_final_calculation_id, params.userId, row.ecs_number);
        ffMarkedPaid++;
      } catch (err) {
        ffFailures.push({
          full_final_calculation_id: row.full_final_calculation_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await db.execute(
    `INSERT INTO fnf_transfer_import (id, file_name, file_sha256, row_count, matched_count, unmatched_count, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), params.fileName, params.fileSha256, params.preview.length, confirmed, params.preview.length - confirmed, params.userId],
  );

  return { confirmed, ff_marked_paid: ffMarkedPaid, ff_mark_paid_failures: ffFailures, skipped: params.preview.length - confirmed };
}
