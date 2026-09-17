import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { bankReconciliationPeriodService, BankReconciliationPeriodError, assertNotInClosedPeriod } from "../bank-reconciliation-period.service.js";

beforeEach(() => { execute.mockReset(); logSensitiveAction.mockClear(); });

describe("bankReconciliationPeriodService.create", () => {
  it("refuses a second open period for the same account", async () => {
    execute
      .mockResolvedValueOnce([[{ opening_balance: 0 }]])
      .mockResolvedValueOnce([[{ id: "existing-open" }]]);
    await expect(bankReconciliationPeriodService.create("acct-1", "2026-09-01", "2026-09-30", "actor-1"))
      .rejects.toThrow(/already has an open/i);
  });

  it("creates a period carrying the account's current opening balance", async () => {
    execute
      .mockResolvedValueOnce([[{ opening_balance: 50000 }]])
      .mockResolvedValueOnce([[]]) // no existing open period
      .mockResolvedValueOnce([[]]) // no overlapping closed period
      .mockResolvedValueOnce([{}]);
    const result = await bankReconciliationPeriodService.create("acct-1", "2026-09-01", "2026-09-30", "actor-1");
    expect(result.id).toBeTruthy();
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO bank_reconciliation_period/), expect.arrayContaining([50000]));
  });

  it("refuses a date range overlapping an already-closed period", async () => {
    execute
      .mockResolvedValueOnce([[{ opening_balance: 0 }]])
      .mockResolvedValueOnce([[]]) // no existing open period
      .mockResolvedValueOnce([[{ id: "closed-1", from_date: "2026-08-01", to_date: "2026-08-31" }]]);
    await expect(bankReconciliationPeriodService.create("acct-1", "2026-08-15", "2026-09-15", "actor-1"))
      .rejects.toThrow(/overlaps a closed period/i);
  });
});

describe("bankReconciliationPeriodService.close", () => {
  it("refuses to close while unmatched statement lines remain", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-09-30", status: "open" }]])
      .mockResolvedValueOnce([[{ cnt: 3 }]]);
    await expect(bankReconciliationPeriodService.close("period-1", 100000, "actor-1")).rejects.toThrow(/unmatched/i);
  });

  it("refuses to close when the reconciliation formula doesn't balance, and reports the difference", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-09-30", status: "open" }]])
      .mockResolvedValueOnce([[{ cnt: 0 }]])
      .mockResolvedValueOnce([[{ running_balance: 95000 }]])
      .mockResolvedValueOnce([[{ total: 2000 }]]);
    // computed(95000) - outstanding(2000) = 93000, statement says 100000 -> off by 7000
    await expect(bankReconciliationPeriodService.close("period-1", 100000, "actor-1")).rejects.toThrow(/7000|7,000/);
  });

  it("closes when the formula balances exactly, locks entries, and carries the balance forward", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-09-30", status: "open" }]])
      .mockResolvedValueOnce([[{ cnt: 0 }]])
      .mockResolvedValueOnce([[{ running_balance: 95000 }]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([{}]) // UPDATE period
      .mockResolvedValueOnce([{}]) // UPDATE bank_account_ledger_entry
      .mockResolvedValueOnce([{}]); // UPDATE company_bank_account
    const result = await bankReconciliationPeriodService.close("period-1", 95000, "actor-1");
    expect(result).toEqual({ closed: true });
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE company_bank_account/), [95000, "2026-09-30", "acct-1"]);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: "BANK_RECONCILIATION_PERIOD_CLOSED" }));
  });

  it("refuses to close a period that isn't open", async () => {
    execute.mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-09-30", status: "closed" }]]);
    await expect(bankReconciliationPeriodService.close("period-1", 95000, "actor-1")).rejects.toThrow(/not open/i);
  });
});

describe("bankReconciliationPeriodService.reopen", () => {
  it("refuses when a later period for the same account is already closed", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-08-31", status: "closed" }]])
      .mockResolvedValueOnce([[{ id: "period-2" }]]);
    await expect(bankReconciliationPeriodService.reopen("period-1", "found a mismatch", "actor-1")).rejects.toThrow(BankReconciliationPeriodError);
  });

  it("requires a reason", async () => {
    await expect(bankReconciliationPeriodService.reopen("period-1", "", "actor-1")).rejects.toThrow(/reason/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses to reopen a period that isn't closed", async () => {
    execute.mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-08-31", status: "open" }]]);
    await expect(bankReconciliationPeriodService.reopen("period-1", "reason", "actor-1")).rejects.toThrow(/not closed/i);
  });

  it("reopens and clears reconciliation_period_id off its entries when no later period is closed", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-08-31", status: "closed" }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);
    await bankReconciliationPeriodService.reopen("period-1", "found a mismatch", "actor-1");
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_account_ledger_entry SET reconciliation_period_id = NULL/), ["period-1"]);
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: "BANK_RECONCILIATION_PERIOD_REOPENED" }));
  });
});

/**
 * assertNotInClosedPeriod guards every bank_account_ledger_entry insert site — Payment Voucher
 * release, direct vendor dispatch, direct imprest allocation, reconciliation adjustments — so a
 * closed period's already-stamped computed_closing_balance/outstanding_total can never silently
 * go stale from a later entry landing inside its window.
 */
describe("assertNotInClosedPeriod", () => {
  it("does nothing when no closed period covers the date", async () => {
    execute.mockResolvedValueOnce([[]]);
    await expect(assertNotInClosedPeriod({ execute } as any, "acct-1", "2026-09-15")).resolves.toBeUndefined();
  });

  it("throws when a closed period covers the date, naming the period's end date", async () => {
    execute.mockResolvedValueOnce([[{ id: "period-1", to_date: "2026-08-31" }]]);
    await expect(assertNotInClosedPeriod({ execute } as any, "acct-1", "2026-08-15"))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("2026-08-31") });
  });

  it("has no lower bound — an entry dated before from_date but still <= to_date is still blocked", async () => {
    // Matches close()'s own closing-balance query, which is also entry_date <= to_date with no
    // floor: an entry dated before the period technically "started" still falls inside the
    // window close() already swept into its computed totals.
    execute.mockResolvedValueOnce([[{ id: "period-1", to_date: "2026-08-31" }]]);
    await expect(assertNotInClosedPeriod({ execute } as any, "acct-1", "2026-01-01"))
      .rejects.toThrow(/closed through 2026-08-31/);
  });
});
