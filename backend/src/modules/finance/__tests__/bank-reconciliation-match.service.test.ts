import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { bankReconciliationMatchService, BankReconciliationMatchError } from "../bank-reconciliation-match.service.js";

beforeEach(() => { execute.mockReset(); logSensitiveAction.mockClear(); });

describe("bankReconciliationMatchService.autoMatch", () => {
  it("matches a statement line to its single exact-amount candidate within the date window", async () => {
    execute
      // SELECT unmatched statement lines for this import
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-05", debit_amount: 50000, credit_amount: 0, bank_account_id: "acct-1" }]])
      // SELECT candidate ledger entries for line-1
      .mockResolvedValueOnce([[{ id: "entry-1", entry_date: "2026-09-06" }]])
      // UPDATE bank_statement_line
      .mockResolvedValueOnce([{}])
      // UPDATE bank_account_ledger_entry
      .mockResolvedValueOnce([{}]);

    const result = await bankReconciliationMatchService.autoMatch("import-1");
    expect(result).toEqual({ matchedCount: 1, unmatchedCount: 0 });
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_statement_line/), ["entry-1", "line-1"]);
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_account_ledger_entry/), ["line-1", "entry-1"]);
  });

  it("leaves a line unmatched when there are zero candidates", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-05", debit_amount: 999, credit_amount: 0, bank_account_id: "acct-1" }]])
      .mockResolvedValueOnce([[]]);
    const result = await bankReconciliationMatchService.autoMatch("import-1");
    expect(result).toEqual({ matchedCount: 0, unmatchedCount: 1 });
  });

  it("leaves a line unmatched when there are multiple candidates (ambiguous, never guessed)", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-05", debit_amount: 50000, credit_amount: 0, bank_account_id: "acct-1" }]])
      .mockResolvedValueOnce([[{ id: "entry-1", entry_date: "2026-09-06" }, { id: "entry-2", entry_date: "2026-09-07" }]]);
    const result = await bankReconciliationMatchService.autoMatch("import-1");
    expect(result).toEqual({ matchedCount: 0, unmatchedCount: 1 });
  });

  it("excludes a candidate outside the 15-day match window even with an exact amount", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-05", debit_amount: 50000, credit_amount: 0, bank_account_id: "acct-1" }]])
      .mockResolvedValueOnce([[{ id: "entry-1", entry_date: "2026-10-01" }]]); // 26 days away
    const result = await bankReconciliationMatchService.autoMatch("import-1");
    expect(result).toEqual({ matchedCount: 0, unmatchedCount: 1 });
  });
});

describe("bankReconciliationMatchService.manualMatch", () => {
  it("rejects a mismatched amount instead of forcing the link", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", debit_amount: 50000, credit_amount: 0, match_status: "unmatched" }]])
      .mockResolvedValueOnce([[{ id: "entry-1", debit_amount: 40000, credit_amount: 0 }]]);
    await expect(bankReconciliationMatchService.manualMatch("line-1", "entry-1", "actor-1"))
      .rejects.toThrow(BankReconciliationMatchError);
  });

  it("refuses to match a statement line that's already resolved", async () => {
    execute.mockResolvedValueOnce([[{ id: "line-1", debit_amount: 50000, credit_amount: 0, match_status: "matched" }]]);
    await expect(bankReconciliationMatchService.manualMatch("line-1", "entry-1", "actor-1"))
      .rejects.toThrow(/already resolved/i);
  });

  it("links a statement line and ledger entry with equal amounts", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", debit_amount: 50000, credit_amount: 0, match_status: "unmatched" }]])
      .mockResolvedValueOnce([[{ id: "entry-1", debit_amount: 50000, credit_amount: 0 }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);
    await bankReconciliationMatchService.manualMatch("line-1", "entry-1", "actor-1");
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_statement_line/), ["entry-1", "line-1"]);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: "BANK_RECONCILIATION_MANUAL_MATCH" }));
  });
});

describe("bankReconciliationMatchService.unmatch", () => {
  it("refuses when the line has no match to undo", async () => {
    execute.mockResolvedValueOnce([[{ matched_ledger_entry_id: null }]]);
    await expect(bankReconciliationMatchService.unmatch("line-1", "actor-1")).rejects.toThrow(BankReconciliationMatchError);
  });

  it("clears both FK links on a matched line", async () => {
    execute
      .mockResolvedValueOnce([[{ matched_ledger_entry_id: "entry-1" }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);
    await bankReconciliationMatchService.unmatch("line-1", "actor-1");
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_account_ledger_entry SET matched_statement_line_id = NULL/), ["entry-1"]);
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_statement_line SET match_status = 'unmatched'/), ["line-1"]);
  });
});

describe("bankReconciliationMatchService.postAdjustment", () => {
  it("inserts a reconciliation_adjustment ledger entry and marks the line 'adjusted'", async () => {
    execute
      // SELECT statement line
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-06", description: "Bank charges", debit_amount: 250, credit_amount: 0, match_status: "unmatched" }]])
      // SELECT ... FOR UPDATE company_bank_account
      .mockResolvedValueOnce([[{ id: "acct-1" }]])
      // SELECT last running_balance
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      // INSERT bank_account_ledger_entry
      .mockResolvedValueOnce([{}])
      // UPDATE bank_statement_line
      .mockResolvedValueOnce([{}]);

    const result = await bankReconciliationMatchService.postAdjustment({
      statementLineId: "line-1", bankAccountId: "acct-1", payableAccountId: "pam-charges",
      narration: "Bank charges per statement", actorUserId: "actor-1",
    });
    expect(result.ledgerEntryId).toBeTruthy();
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO bank_account_ledger_entry/), expect.arrayContaining(["reconciliation_adjustment"]));
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: "BANK_RECONCILIATION_ADJUSTMENT_POSTED" }));
  });

  it("refuses to post an adjustment for an already-resolved statement line", async () => {
    execute.mockResolvedValueOnce([[{ id: "line-1", match_status: "matched" }]]);
    await expect(bankReconciliationMatchService.postAdjustment({
      statementLineId: "line-1", bankAccountId: "acct-1", payableAccountId: "pam-charges",
      narration: "x", actorUserId: "actor-1",
    })).rejects.toThrow(/already resolved/i);
  });
});
