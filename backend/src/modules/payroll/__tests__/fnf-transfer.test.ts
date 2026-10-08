/**
 * Full & Final settlement disbursement — its own bank-transfer batch.
 *
 * Owner ruling 2026-09-12 (Q6 + Q7): F&F gets its own bank-transfer batch, separate from
 * monthly salary, using the same bank-file machinery and approvals — and a leaver without a
 * signed NOC must not appear in it, unconditionally (every row here is a leaver by
 * construction, unlike the salary export where NOC sits behind a kill switch).
 *
 * db.execute is mocked directly, same style as salary-transfer-noc-gate.test.ts, so this
 * exercises the real SQL these functions issue, not a stand-in for it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getConnection } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../../shared/fieldEncryption.js", () => ({
  resolveAccountNumber: (row: { account_number_enc?: string | null; account_number?: string | null }) =>
    row.account_number_enc ?? row.account_number ?? null,
}));

const { nocReleaseStatusForEmployee } = vi.hoisted(() => ({ nocReleaseStatusForEmployee: vi.fn() }));
vi.mock("../noc-release-gate.service.js", () => ({ nocReleaseStatusForEmployee }));

const { markFfPaid } = vi.hoisted(() => ({ markFfPaid: vi.fn() }));
vi.mock("../../exit/ff.service.js", () => ({ ffService: { markFfPaid } }));

const { getDebitAccountNumber } = vi.hoisted(() => ({ getDebitAccountNumber: vi.fn() }));
vi.mock("../payroll-debit-account-config.service.js", () => ({ getDebitAccountNumber }));

const {
  getEligibleFnfTransferRows,
  generateFnfTransferBatch,
  previewFnfTransferNumberImport,
  commitFnfTransferNumberImport,
  rejectFnfTransferItems,
  markFnfItemCorrectedReady,
} = await import("../fnf-transfer.service.js");

const CLEARED = { blocked: false, reason: null, caseStatus: "completed", hasCase: true, overridden: false };
const BLOCKED_IN_PROGRESS = { blocked: true, reason: "NOC clearance is in progress — not all signatories have responded.", caseStatus: "in_progress", hasCase: true, overridden: false };
const BLOCKED_NO_CASE = { blocked: true, reason: "No NOC clearance has been raised for this inactive employee.", caseStatus: null, hasCase: false, overridden: false };

const APPROVED_FF = {
  full_final_calculation_id: "ff-1",
  exit_request_id: "exit-1",
  employee_id: "emp-1",
  net_payable: 55000,
  employee_code: "MAS1001",
  employee_name: "Cleared Leaver",
  account_number_enc: "1112223334",
  account_number_legacy: null,
  ifsc_code: "hdfc0001234",
  bank_name: "HDFC",
};
const APPROVED_FF_2 = {
  ...APPROVED_FF,
  full_final_calculation_id: "ff-2",
  exit_request_id: "exit-2",
  employee_id: "emp-2",
  employee_code: "MAS1002",
  employee_name: "Pending NOC Leaver",
};

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  nocReleaseStatusForEmployee.mockReset();
  markFfPaid.mockReset();
  getDebitAccountNumber.mockReset();
  getDebitAccountNumber.mockResolvedValue("033005005852");
});

describe("getEligibleFnfTransferRows", () => {
  it("includes an approved, non-provisional, NOC-cleared settlement with a valid account", async () => {
    execute.mockResolvedValueOnce([[APPROVED_FF]]); // the ff/employee/bank-detail join
    nocReleaseStatusForEmployee.mockResolvedValueOnce(CLEARED);

    const { rows, ineligible } = await getEligibleFnfTransferRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_final_calculation_id: "ff-1", amount: 55000 });
    expect(ineligible).toEqual([]);
  });

  it("only asks the database for approved, non-provisional, positive-net-payable, not-already-open settlements", async () => {
    execute.mockResolvedValueOnce([[]]);

    await getEligibleFnfTransferRows();

    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/ff\.status\s*=\s*'approved'/);
    expect(sql).toMatch(/ff\.is_ff_provisional\s*=\s*0/);
    expect(sql).toMatch(/ff\.net_payable.*>\s*0/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/fnf_transfer_batch_item/);
  });

  it("excludes a settlement the NOC gate blocks, and reports why — unconditionally, not behind a kill switch", async () => {
    // The whole point of Q7: this function must call nocReleaseStatusForEmployee and act on
    // it directly. It must NOT check any kill switch first — every row here is a leaver by
    // construction, so there is no "doesn't apply to most of the population" case to protect
    // a misconfigured flag against, unlike the salary export's NOC gate.
    execute.mockResolvedValueOnce([[APPROVED_FF_2]]);
    nocReleaseStatusForEmployee.mockResolvedValueOnce(BLOCKED_IN_PROGRESS);

    const { rows, ineligible } = await getEligibleFnfTransferRows();

    expect(rows).toEqual([]);
    expect(ineligible).toHaveLength(1);
    expect(ineligible[0]).toMatchObject({
      full_final_calculation_id: "ff-2",
      employee_code: "MAS1002",
      reason: BLOCKED_IN_PROGRESS.reason,
    });
  });

  it("reports 'not raised' when the employee has no NOC case at all", async () => {
    execute.mockResolvedValueOnce([[APPROVED_FF_2]]);
    nocReleaseStatusForEmployee.mockResolvedValueOnce(BLOCKED_NO_CASE);

    const { ineligible } = await getEligibleFnfTransferRows();

    expect(ineligible[0].reason).toMatch(/No NOC clearance has been raised/i);
  });

  it("checks NOC for every settlement independently — one cleared, one blocked, in the same population", async () => {
    execute.mockResolvedValueOnce([[APPROVED_FF, APPROVED_FF_2]]);
    nocReleaseStatusForEmployee.mockImplementation(async (employeeId: string) =>
      employeeId === "emp-1" ? CLEARED : BLOCKED_IN_PROGRESS,
    );

    const { rows, ineligible } = await getEligibleFnfTransferRows();

    expect(rows.map((r) => r.employee_id)).toEqual(["emp-1"]);
    expect(ineligible.map((i) => i.employee_id)).toEqual(["emp-2"]);
    expect(nocReleaseStatusForEmployee).toHaveBeenCalledTimes(2);
  });

  it("excludes a NOC-cleared settlement with no active primary bank account, and says so", async () => {
    execute.mockResolvedValueOnce([[{ ...APPROVED_FF, account_number_enc: null, account_number_legacy: null }]]);
    nocReleaseStatusForEmployee.mockResolvedValueOnce(CLEARED);

    const { rows, ineligible } = await getEligibleFnfTransferRows();

    expect(rows).toEqual([]);
    expect(ineligible[0].reason).toMatch(/bank account/i);
  });

  it("excludes a NOC-cleared settlement with an invalid IFSC, and says so", async () => {
    execute.mockResolvedValueOnce([[{ ...APPROVED_FF, ifsc_code: "not-an-ifsc" }]]);
    nocReleaseStatusForEmployee.mockResolvedValueOnce(CLEARED);

    const { rows, ineligible } = await getEligibleFnfTransferRows();

    expect(rows).toEqual([]);
    expect(ineligible[0].reason).toMatch(/IFSC/i);
  });
});

describe("generateFnfTransferBatch", () => {
  function mockGenerate(rows: any[]) {
    execute.mockReset();
    execute.mockResolvedValueOnce([rows]); // eligibility join query
    const conn = {
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(() => undefined),
    };
    getConnection.mockResolvedValueOnce(conn);
    return conn;
  }

  it("writes one fnf_transfer_batch row and one item row per eligible settlement", async () => {
    nocReleaseStatusForEmployee.mockResolvedValue(CLEARED);
    const conn = mockGenerate([APPROVED_FF]);

    const result = await generateFnfTransferBatch({ userId: "user-1" });

    expect(result.row_count).toBe(1);
    expect(result.total_amount).toBe(55000);
    expect(result.batch_number).toMatch(/^FF-/); // distinct prefix from salary's ST-
    const inserts = conn.execute.mock.calls.filter((c: any[]) => /INSERT INTO/.test(String(c[0])));
    expect(inserts).toHaveLength(2); // batch + one item
    expect(String(inserts[0][0])).toMatch(/INSERT INTO fnf_transfer_batch\b/);
    expect(String(inserts[1][0])).toMatch(/INSERT INTO fnf_transfer_batch_item\b/);
  });

  it("commits the transaction on success and never rolls back", async () => {
    nocReleaseStatusForEmployee.mockResolvedValue(CLEARED);
    const conn = mockGenerate([APPROVED_FF]);

    await generateFnfTransferBatch({ userId: "user-1" });

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the connection when a write fails mid-batch", async () => {
    nocReleaseStatusForEmployee.mockResolvedValue(CLEARED);
    execute.mockReset();
    execute.mockResolvedValueOnce([[APPROVED_FF]]);
    const conn = {
      execute: vi.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // batch insert ok
        .mockRejectedValueOnce(new Error("db gone")), // item insert fails
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(() => undefined),
    };
    getConnection.mockResolvedValueOnce(conn);

    await expect(generateFnfTransferBatch({ userId: "user-1" })).rejects.toThrow("db gone");

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("throws NO_ELIGIBLE_ROWS when nothing is eligible, and writes nothing", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce([[]]); // no F&F rows at all

    await expect(generateFnfTransferBatch({ userId: "user-1" })).rejects.toMatchObject({ code: "NO_ELIGIBLE_ROWS" });
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("narrows to an explicit selection of full_final_calculation ids", async () => {
    nocReleaseStatusForEmployee.mockResolvedValue(CLEARED);
    const conn = mockGenerate([APPROVED_FF, APPROVED_FF_2]);

    const result = await generateFnfTransferBatch({ userId: "user-1", fullFinalCalculationIds: ["ff-1"] });

    expect(result.row_count).toBe(1);
    const itemInsert = conn.execute.mock.calls.find((c: any[]) => /INSERT INTO fnf_transfer_batch_item/.test(String(c[0])));
    expect(itemInsert![1]).toContain("ff-1");
    expect(itemInsert![1]).not.toContain("ff-2");
  });

  it("reports an explicitly-requested id that is no longer eligible, rather than silently dropping it", async () => {
    nocReleaseStatusForEmployee.mockResolvedValue(CLEARED);
    mockGenerate([APPROVED_FF]);

    const result = await generateFnfTransferBatch({ userId: "user-1", fullFinalCalculationIds: ["ff-1", "ff-does-not-exist"] });

    expect(result.excluded).toEqual([{ full_final_calculation_id: "ff-does-not-exist", reason: "no longer eligible at export time" }]);
  });
});

describe("previewFnfTransferNumberImport — not scoped to a run, unlike salary's import", () => {
  it("matches purely by employee_code, with no run_id predicate at all", async () => {
    execute.mockResolvedValueOnce([[]]);

    await previewFnfTransferNumberImport([{ emp_code: "MAS1001", emp_name: "X", ecs_number: "E1", trf_date: "1-Jan-26", branch: "HO" }]);

    const sql = String(execute.mock.calls[0][0]);
    expect(sql).not.toMatch(/run_id/i);
    expect(sql).toMatch(/fnf_transfer_batch_item/);
  });

  it("marks will_confirm for an exported item and carries its full_final_calculation_id through", async () => {
    execute.mockResolvedValueOnce([[{ id: "item-1", employee_code: "MAS1001", status: "exported", full_final_calculation_id: "ff-1" }]]);

    const preview = await previewFnfTransferNumberImport([
      { emp_code: "MAS1001", emp_name: "X", ecs_number: "E1", trf_date: "1-Jan-26", branch: "HO" },
    ]);

    expect(preview[0]).toMatchObject({ outcome: "will_confirm", item_id: "item-1", full_final_calculation_id: "ff-1" });
  });

  it("marks unmatched when no fnf item exists for the code", async () => {
    execute.mockResolvedValueOnce([[]]);

    const preview = await previewFnfTransferNumberImport([
      { emp_code: "MAS9999", emp_name: "X", ecs_number: "E1", trf_date: "1-Jan-26", branch: "HO" },
    ]);

    expect(preview[0].outcome).toBe("unmatched");
  });
});

describe("commitFnfTransferNumberImport — closes the loop into ff.service.markFfPaid", () => {
  const PREVIEW_ROW = {
    emp_code: "MAS1001", emp_name: "X", ecs_number: "UTR123", trf_date: "1-Jan-26", branch: "HO",
    outcome: "will_confirm" as const, detail: "OK", item_id: "item-1", full_final_calculation_id: "ff-1",
  };

  it("confirms the transfer item and marks the matching settlement paid using the bank's own reference", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce([[]]); // no existing import (not a re-upload)
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]); // the item UPDATE
    execute.mockResolvedValueOnce([{}]); // the fnf_transfer_import INSERT
    markFfPaid.mockResolvedValueOnce({});

    const result = await commitFnfTransferNumberImport({
      preview: [PREVIEW_ROW], fileName: "f.csv", fileSha256: "abc", userId: "user-1",
    });

    expect(result.confirmed).toBe(1);
    expect(result.ff_marked_paid).toBe(1);
    expect(result.ff_mark_paid_failures).toEqual([]);
    // The transfer's OWN ecs_number becomes the payment reference — not a value typed by hand.
    expect(markFfPaid).toHaveBeenCalledWith("ff-1", "user-1", "UTR123");
  });

  it("does not roll back the confirmed transfer when markFfPaid refuses (maker-checker)", async () => {
    // The money has left the bank account regardless of who is allowed to record it in this
    // system, so the transfer confirmation must stand even when ff.service's own guard fires.
    execute.mockReset();
    execute.mockResolvedValueOnce([[]]);
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    execute.mockResolvedValueOnce([{}]);
    markFfPaid.mockRejectedValueOnce(
      Object.assign(new Error("Payment must be recorded by someone other than the person who approved this settlement"), { statusCode: 403 }),
    );

    const result = await commitFnfTransferNumberImport({
      preview: [PREVIEW_ROW], fileName: "f.csv", fileSha256: "abc", userId: "user-1",
    });

    expect(result.confirmed).toBe(1); // the transfer itself IS confirmed
    expect(result.ff_marked_paid).toBe(0);
    expect(result.ff_mark_paid_failures).toEqual([
      { full_final_calculation_id: "ff-1", error: "Payment must be recorded by someone other than the person who approved this settlement" },
    ]);
  });

  it("is idempotent on a re-uploaded file — no double confirmation, no double markFfPaid", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce([[{ id: "existing-import" }]]); // already imported

    const result = await commitFnfTransferNumberImport({
      preview: [PREVIEW_ROW], fileName: "f.csv", fileSha256: "abc", userId: "user-1",
    });

    expect(result.confirmed).toBe(0);
    expect(markFfPaid).not.toHaveBeenCalled();
  });

  it("skips a row the UPDATE did not actually match, and never calls markFfPaid for it", async () => {
    // Another commit got there first between preview and commit — the UPDATE's own
    // WHERE status = 'exported' predicate is what prevents double-processing.
    execute.mockReset();
    execute.mockResolvedValueOnce([[]]);
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    execute.mockResolvedValueOnce([{}]);

    const result = await commitFnfTransferNumberImport({
      preview: [PREVIEW_ROW], fileName: "f.csv", fileSha256: "abc", userId: "user-1",
    });

    expect(result.confirmed).toBe(0);
    expect(markFfPaid).not.toHaveBeenCalled();
  });
});

describe("rejectFnfTransferItems / markFnfItemCorrectedReady — mirror salary's shape exactly", () => {
  it("rejects only exported items, writing the reason and note", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 2 }]);

    const result = await rejectFnfTransferItems({ itemIds: ["a", "b"], reason: "kyc_pending", note: "waiting on docs", userId: "user-1" });

    expect(result.updated).toBe(2);
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/UPDATE fnf_transfer_batch_item/);
    expect(sql).toMatch(/status = 'exported'/);
  });

  it("returns 0 without querying when itemIds is empty", async () => {
    const result = await rejectFnfTransferItems({ itemIds: [], reason: "other", userId: "user-1" });
    expect(result.updated).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("marks a rejected item corrected_ready, never any other status", async () => {
    execute.mockResolvedValueOnce([{}]);
    await markFnfItemCorrectedReady("item-1");
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/status = 'corrected_ready'/);
    expect(sql).toMatch(/AND status = 'rejected'/);
  });
});
