import { randomUUID } from "crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { refuse } from "../process-pnl/finance-error.js";
import { journalService, type JournalLineInput } from "./journal.service.js";
import type { Voucher } from "./salary-voucher.service.js";

/**
 * Wires the Tally salary voucher (salary-voucher.service.ts) to the journal engine
 * (journal.service.ts). A deliberately separate path from grn-journal-posting.service.ts —
 * see 1803_payroll_ledger_voucher.sql's own header for why the historical grn_type='salary'
 * GRNs are never posted through the generic GRN path.
 *
 * ACCOUNT MAPPING (owner-confirmed defaults, 2026-09-17 — flagged for correction if wrong)
 *   Gross Salary (the plug, Dr)                                  -> expense_sub_head "Gross Salary"
 *   Employer PF + Employer ESIC + EPF Admin Charges (Dr, summed) -> expense_sub_head "Employer Statutory Contribution"
 *   Salary Payable A/C (Cr)                                      -> payable_account "Salary Payable"
 *   EPF Payable + ESIC Payable (Cr, summed)                      -> payable_account "Statutory Dues"
 *   TDS SALARY <FY> (Cr)                                         -> payable_account "TDS Payable"
 *   Advance Against Salary (per employee) + GROSS SALARY (misc   -> payable_account "Other"
 *     recoveries) + STAY HEALTHY STAY HAPPY INSURANCE (Cr, summed)
 * Grouping by account rather than posting the voucher's own per-cohort/per-employee line detail
 * is deliberate: the ledger needs the accounting event to balance, not the Tally CSV's own
 * per-employee traceability (that's what /vouchers/export already provides). Summing existing
 * balanced lines into fewer buckets cannot unbalance the entry — the total per side is
 * unchanged, only the grouping is coarser.
 *
 * ONE-TIME POSTING. payroll_ledger_voucher's UNIQUE KEY (run_id, branch_id) is the real guard;
 * a payroll run is never recalculated in place (salary-voucher.service.ts's own header: "NOTHING
 * HERE RECALCULATES PAYROLL"), so there is no legitimate reason to post the same voucher twice.
 * A correction goes through journalService.reverse(), never a second post().
 */

async function resolveExpenseSubHeadAccountId(connection: PoolConnection, subHeadName: string): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT sh.id
       FROM finance_expense_sub_head_master sh
       JOIN finance_expense_head_master h ON h.id = sh.head_id
      WHERE h.head_name = 'Salary & Workman Compensation'
        AND sh.sub_head_name = ?
        AND sh.active_status = 1 AND h.active_status = 1
      LIMIT 1`,
    [subHeadName],
  );
  const row = rows[0];
  if (!row) {
    throw refuse(422, "PAYROLL_LEDGER_HEAD_NOT_FOUND", `No active "${subHeadName}" sub-head under Salary & Workman Compensation — run migration 1803 first.`);
  }
  return String(row.id);
}

async function resolvePayableAccountId(connection: PoolConnection, accountName: string): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM payable_account_master WHERE account_name = ? AND active_status = 1 LIMIT 1`,
    [accountName],
  );
  const row = rows[0];
  if (!row) {
    throw refuse(422, "PAYROLL_PAYABLE_ACCOUNT_NOT_FOUND", `The "${accountName}" ledger head is missing or inactive.`);
  }
  return String(row.id);
}

/** Sums every voucher line whose ledger_name is in `names` on the given side. */
function sumLines(voucher: Voucher, names: string[], side: "D" | "C"): number {
  return voucher.lines
    .filter((l) => l.debit_credit === side && names.includes(l.ledger_name))
    .reduce((s, l) => s + Number(l.amount), 0);
}

/** Sums every voucher line whose ledger_name STARTS WITH a prefix (the per-employee advance rows,
 *  whose ledger_name carries the branch name and are never a fixed string). */
function sumLinesByPrefix(voucher: Voucher, prefix: string, side: "D" | "C"): number {
  return voucher.lines
    .filter((l) => l.debit_credit === side && l.ledger_name.startsWith(prefix))
    .reduce((s, l) => s + Number(l.amount), 0);
}

export async function postSalaryVoucherToLedger(
  connection: PoolConnection,
  runId: string,
  voucher: Voucher,
  actorUserId: string,
): Promise<{ journalEntryId: string; payrollLedgerVoucherId: string }> {
  const [existing] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM payroll_ledger_voucher WHERE run_id = ? AND branch_id = ? LIMIT 1`,
    [runId, voucher.branch_id],
  );
  if (existing[0]) {
    throw refuse(409, "PAYROLL_VOUCHER_ALREADY_POSTED", `${voucher.voucher_no} was already posted to the ledger — a payroll run is never re-posted, only reversed.`);
  }

  const [grossSalaryId, employerStatutoryId, salaryPayableId, statutoryDuesId, tdsPayableId, otherId] = await Promise.all([
    resolveExpenseSubHeadAccountId(connection, "Gross Salary"),
    resolveExpenseSubHeadAccountId(connection, "Employer Statutory Contribution"),
    resolvePayableAccountId(connection, "Salary Payable"),
    resolvePayableAccountId(connection, "Statutory Dues"),
    resolvePayableAccountId(connection, "TDS Payable"),
    resolvePayableAccountId(connection, "Other"),
  ]);

  const grossSalary = sumLines(voucher, ["Gross Salary"], "D");
  const employerStatutory = sumLines(
    voucher,
    ["Employer's Contribution to Esic", "Employer's Contribution to Epf", "EPF Admin Charges"],
    "D",
  );
  const salaryPayable = sumLines(voucher, ["Salary Payable A/C"], "C");
  const statutoryDues = sumLines(voucher, ["ESIC Payable", "EPF Payable"], "C");
  // ledger_name is "TDS SALARY <FY>" (financialYearLabel() in salary-voucher.service.ts) —
  // matched by prefix, same as the per-employee advance rows below, rather than reconstructing
  // the FY string here and risking it drifting out of sync with that function's own format.
  const tdsPayable = sumLinesByPrefix(voucher, "TDS SALARY", "C");
  const otherCredits =
    sumLinesByPrefix(voucher, "Advance Against Salary", "C")
    + sumLines(voucher, ["GROSS SALARY", "STAY HEALTHY STAY HAPPY INSURANCE"], "C");

  const lines: JournalLineInput[] = [];
  if (grossSalary > 0) lines.push({ accountType: "expense_sub_head", accountId: grossSalaryId, debitAmount: grossSalary, narration: "Gross Salary" });
  if (employerStatutory > 0) lines.push({ accountType: "expense_sub_head", accountId: employerStatutoryId, debitAmount: employerStatutory, narration: "Employer Statutory Contribution" });
  if (salaryPayable > 0) lines.push({ accountType: "payable_account", accountId: salaryPayableId, creditAmount: salaryPayable, narration: "Salary Payable" });
  if (statutoryDues > 0) lines.push({ accountType: "payable_account", accountId: statutoryDuesId, creditAmount: statutoryDues, narration: "EPF + ESIC Payable" });
  if (tdsPayable > 0) lines.push({ accountType: "payable_account", accountId: tdsPayableId, creditAmount: tdsPayable, narration: "TDS Payable" });
  if (otherCredits > 0) lines.push({ accountType: "payable_account", accountId: otherId, creditAmount: otherCredits, narration: "Advances + misc recoveries" });

  const payrollLedgerVoucherId = randomUUID();
  const { journalEntryId } = await journalService.post(connection, {
    entryDate: voucher.date,
    narration: `Salary voucher ${voucher.voucher_no} — ${voucher.narration}`,
    sourceType: "payroll",
    sourceId: payrollLedgerVoucherId,
    postedBy: actorUserId,
    branchId: voucher.branch_id,
    lines,
  });

  await connection.execute<ResultSetHeader>(
    `INSERT INTO payroll_ledger_voucher
       (id, run_id, branch_id, company_code, voucher_no, period, total_debit, total_credit, journal_entry_id, posted_by, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      payrollLedgerVoucherId, runId, voucher.branch_id, voucher.company_code, voucher.voucher_no,
      periodFromDate(voucher.date), voucher.totals.debit, voucher.totals.credit, journalEntryId, actorUserId,
    ],
  );

  return { journalEntryId, payrollLedgerVoucherId };
}

function periodFromDate(date: string): string {
  return date.slice(0, 7);
}
