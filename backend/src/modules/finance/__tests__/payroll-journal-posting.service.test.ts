import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Voucher } from "../salary-voucher.service.js";

const { post } = vi.hoisted(() => ({ post: vi.fn().mockResolvedValue({ journalEntryId: "je-1" }) }));
vi.mock("../journal.service.js", () => ({ journalService: { post } }));

import { postSalaryVoucherToLedger } from "../payroll-journal-posting.service.js";

const SUB_HEAD_IDS: Record<string, string> = {
  "Gross Salary": "sh-gross-salary",
  "Employer Statutory Contribution": "sh-employer-statutory",
};
const PAYABLE_IDS: Record<string, string> = {
  "Salary Payable": "pam-salary-payable",
  "Statutory Dues": "pam-statutory-dues",
  "TDS Payable": "pam-tds-payable",
  "Other": "pam-other",
};

function mockConnection(options: { existingPosting?: any; missingSubHead?: string; missingPayable?: string } = {}) {
  const inserted: any[] = [];
  return {
    execute: vi.fn(async (sql: string, params?: any[]) => {
      if (/SELECT id FROM payroll_ledger_voucher/.test(sql)) {
        return [options.existingPosting ? [options.existingPosting] : []];
      }
      if (/finance_expense_sub_head_master/.test(sql)) {
        const name = String(params?.[0]);
        if (name === options.missingSubHead) return [[]];
        return [SUB_HEAD_IDS[name] ? [{ id: SUB_HEAD_IDS[name] }] : []];
      }
      if (/payable_account_master/.test(sql)) {
        const name = String(params?.[0]);
        if (name === options.missingPayable) return [[]];
        return [PAYABLE_IDS[name] ? [{ id: PAYABLE_IDS[name] }] : []];
      }
      if (/INSERT INTO payroll_ledger_voucher/.test(sql)) {
        inserted.push(params);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }),
    _inserted: inserted,
  } as any;
}

/** Shaped exactly like buildVoucher()'s real output for a company with no cohort rules
 *  (columnCount=1) — one HEAD OFFICE voucher, one employee advance. */
function buildTestVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    voucher_no: "HEAD OFFICE/MAS/06/26/1",
    company_code: "MAS",
    branch_id: "branch-ho",
    branch_name: "HEAD OFFICE",
    cost_category: "HEAD OFFICE",
    cost_centre: "HO/2606",
    voucher_type: "JRNLSAL",
    date: "2026-06-30",
    narration: "Salary Jun Month",
    cohort_labels: ["Staff"],
    // Gross Salary is the balancing plug (salary-voucher.service.ts's central invariant): it
    // must equal (sum of every other credit) - (sum of the 3 employer debits) for the voucher
    // to actually balance, same as the real generator guarantees. Here: credits 118700 -
    // otherDebits 4200 = 114500.
    lines: [
      { ledger_name: "Gross Salary", debit_credit: "D", amount: 114500, columns: [114500] },
      { ledger_name: "Employer's Contribution to Esic", debit_credit: "D", amount: 300, columns: [300] },
      { ledger_name: "Employer's Contribution to Epf", debit_credit: "D", amount: 3600, columns: [3600] },
      { ledger_name: "EPF Admin Charges", debit_credit: "D", amount: 300, columns: [300] },
      { ledger_name: "Salary Payable A/C", debit_credit: "C", amount: 100000, columns: [100000] },
      { ledger_name: "ESIC Payable", debit_credit: "C", amount: 550, columns: [550] },
      { ledger_name: "EPF Payable", debit_credit: "C", amount: 7900, columns: [7900] },
      { ledger_name: "Advance Against Salary (HEAD OFFICE)", debit_credit: "C", amount: 5000, columns: [5000], employee_code: "MAS001" },
      { ledger_name: "STAY HEALTHY STAY HAPPY INSURANCE", debit_credit: "C", amount: 0, columns: [0] },
      { ledger_name: "GROSS SALARY", debit_credit: "C", amount: 850, columns: [850] },
      { ledger_name: "TDS SALARY 2026-27", debit_credit: "C", amount: 4400, columns: [4400] },
    ],
    totals: { debit: 118700, credit: 118700, balanced: true },
    payroll_gross: 118700,
    employees: 16,
    ...overrides,
  };
}

beforeEach(() => { post.mockClear(); });

describe("postSalaryVoucherToLedger", () => {
  it("groups the voucher's own balanced lines into 6 journal lines that still balance", async () => {
    const conn = mockConnection();
    const voucher = buildTestVoucher();

    await postSalaryVoucherToLedger(conn, "run-1", voucher, "finance-head-1");

    expect(post).toHaveBeenCalledTimes(1);
    const call = post.mock.calls[0][1];
    expect(call.sourceType).toBe("payroll");
    expect(call.entryDate).toBe("2026-06-30");
    expect(call.branchId).toBe("branch-ho");
    expect(call.lines).toEqual([
      { accountType: "expense_sub_head", accountId: "sh-gross-salary", debitAmount: 114500, narration: "Gross Salary" },
      { accountType: "expense_sub_head", accountId: "sh-employer-statutory", debitAmount: 4200, narration: "Employer Statutory Contribution" },
      { accountType: "payable_account", accountId: "pam-salary-payable", creditAmount: 100000, narration: "Salary Payable" },
      { accountType: "payable_account", accountId: "pam-statutory-dues", creditAmount: 8450, narration: "EPF + ESIC Payable" },
      { accountType: "payable_account", accountId: "pam-tds-payable", creditAmount: 4400, narration: "TDS Payable" },
      { accountType: "payable_account", accountId: "pam-other", creditAmount: 5850, narration: "Advances + misc recoveries" },
    ]);
    const debitTotal = call.lines.filter((l: any) => l.debitAmount).reduce((s: number, l: any) => s + l.debitAmount, 0);
    const creditTotal = call.lines.filter((l: any) => l.creditAmount).reduce((s: number, l: any) => s + l.creditAmount, 0);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(voucher.totals.debit);
  });

  it("records a payroll_ledger_voucher row with the returned journal_entry_id", async () => {
    const conn = mockConnection();
    const { journalEntryId, payrollLedgerVoucherId } = await postSalaryVoucherToLedger(conn, "run-1", buildTestVoucher(), "finance-head-1");

    expect(journalEntryId).toBe("je-1");
    const insertCall = conn._inserted[0];
    expect(insertCall).toEqual([
      payrollLedgerVoucherId, "run-1", "branch-ho", "MAS", "HEAD OFFICE/MAS/06/26/1",
      "2026-06", 118700, 118700, "je-1", "finance-head-1",
    ]);
  });

  it("omits a journal line entirely when its bucket sums to zero (e.g. no advances this run)", async () => {
    const conn = mockConnection();
    const voucher = buildTestVoucher({
      lines: buildTestVoucher().lines.filter((l) => !l.ledger_name.startsWith("Advance") && l.ledger_name !== "GROSS SALARY" && l.ledger_name !== "STAY HEALTHY STAY HAPPY INSURANCE"),
    });
    await postSalaryVoucherToLedger(conn, "run-1", voucher, "finance-head-1");
    const call = post.mock.calls[0][1];
    expect(call.lines.some((l: any) => l.narration === "Advances + misc recoveries")).toBe(false);
  });

  it("refuses with PAYROLL_VOUCHER_ALREADY_POSTED when this (run, branch) was already posted", async () => {
    const conn = mockConnection({ existingPosting: { id: "plv-existing" } });
    await expect(
      postSalaryVoucherToLedger(conn, "run-1", buildTestVoucher(), "finance-head-1"),
    ).rejects.toMatchObject({ code: "PAYROLL_VOUCHER_ALREADY_POSTED", statusCode: 409 });
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses with PAYROLL_LEDGER_HEAD_NOT_FOUND when the Gross Salary sub-head is missing (migration 1803 not applied)", async () => {
    const conn = mockConnection({ missingSubHead: "Gross Salary" });
    await expect(
      postSalaryVoucherToLedger(conn, "run-1", buildTestVoucher(), "finance-head-1"),
    ).rejects.toMatchObject({ code: "PAYROLL_LEDGER_HEAD_NOT_FOUND", statusCode: 422 });
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses with PAYROLL_PAYABLE_ACCOUNT_NOT_FOUND when a payable account (e.g. Statutory Dues) is missing or inactive", async () => {
    const conn = mockConnection({ missingPayable: "Statutory Dues" });
    await expect(
      postSalaryVoucherToLedger(conn, "run-1", buildTestVoucher(), "finance-head-1"),
    ).rejects.toMatchObject({ code: "PAYROLL_PAYABLE_ACCOUNT_NOT_FOUND", statusCode: 422 });
    expect(post).not.toHaveBeenCalled();
  });
});
