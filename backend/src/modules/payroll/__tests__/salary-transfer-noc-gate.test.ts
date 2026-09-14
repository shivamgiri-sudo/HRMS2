/**
 * NOC gate on the salary-transfer export — owner ruling 2026-09-12: "A leaver without a signed
 * NOC must not appear in the bank file."
 *
 * noc-release-gate.service.ts already existed with the rule, a kill switch and a reporting
 * query (nocBlockedEmployeesForRuns), but its own header records that nothing in the payment
 * pipeline ever called it: getEligibleTransferRows had zero NOC predicate. These tests pin
 * getEligibleTransferRowsWithNocExclusions, the function that closes that gap, and its two
 * back-compat wrappers.
 *
 * mysql2's db.execute is mocked directly rather than mocking bank-payment-readiness.service.ts
 * or noc-release-gate.service.ts, so this exercises the real SQL nocBlockedEmployeesForRuns
 * issues, not a stand-in for it — the same style as noc-clearance-gating.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getConnection } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../../shared/fieldEncryption.js", () => ({
  // Pass the legacy plaintext straight through — decryption correctness is out of scope here.
  resolveAccountNumber: (row: { account_number_enc?: string | null; account_number?: string | null }) =>
    row.account_number_enc ?? row.account_number ?? null,
}));

const {
  getEligibleTransferRows,
  getEligibleTransferRowsWithNocExclusions,
  getFilteredEligibleTransferRows,
  getFilteredEligibleTransferRowsWithNocExclusions,
} = await import("../salary-transfer.service.js");
const { buildBankReadinessReport } = await import("../bank-payment-readiness.service.js");

vi.mock("../bank-payment-readiness.service.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, buildBankReadinessReport: vi.fn() };
});

const RUN_ID = "run-1";
const READY_EMPLOYEE = {
  employee_id: "emp-ready",
  employee_code: "MAS1001",
  net_salary: 30000,
  employee_name: "Ready Employee",
  mobile: "9999999999",
  email: "e1@example.com",
  active_status: 1,
  branch_id: "b1",
  process_id: "p1",
  cost_centre_id: "cc1",
  branch_name: "Branch One",
  process_name: "Process One",
  cost_centre_name: "CC One",
  account_number_enc: "1234567890",
  account_number_legacy: null,
  ifsc_code: "hdfc0001234",
  bank_name: "HDFC",
};
const NOC_PENDING_EMPLOYEE = {
  ...READY_EMPLOYEE,
  employee_id: "emp-noc-pending",
  employee_code: "MAS1002",
  employee_name: "Leaver Pending NOC",
  active_status: 0,
};

function mockReadinessReport(ids: string[]) {
  (buildBankReadinessReport as any).mockResolvedValueOnce({
    as_of: new Date().toISOString(),
    run_id: RUN_ID,
    rows: ids.map((employee_id) => ({ employee_id, payable: true })),
    summary: {},
  });
}

/**
 * Queues the mocks for one call to getEligibleTransferRowsWithNocExclusions, in exact call
 * order: open-items check, nocBlockedEmployeesForRuns' two-part gate (kill-switch flag, then
 * the withheld query) IF the gate is enabled, then the employee/bank-detail line query.
 */
function mockRun(opts: {
  lines: Array<Record<string, unknown>>;
  gateEnabled?: boolean;
  nocBlocked?: Array<{ employee_id: string; employee_code: string; employee_name: string; net_salary: number; case_status: string | null; pending_stages: string | null }>;
}) {
  execute.mockReset();
  execute.mockResolvedValueOnce([[]]); // no already-open items
  execute.mockResolvedValueOnce([[{ config_value: opts.gateEnabled === false ? "false" : "true" }]]); // kill-switch flag
  if (opts.gateEnabled !== false) {
    execute.mockResolvedValueOnce([opts.nocBlocked ?? []]); // nocBlockedEmployeesForRuns' own query
  }
  execute.mockResolvedValueOnce([opts.lines]); // the employee/bank-detail line query
}

beforeEach(() => {
  (buildBankReadinessReport as any).mockReset();
});

describe("getEligibleTransferRowsWithNocExclusions", () => {
  it("excludes an employee the NOC gate has withheld, and reports why", async () => {
    mockReadinessReport([READY_EMPLOYEE.employee_id, NOC_PENDING_EMPLOYEE.employee_id]);
    mockRun({
      lines: [READY_EMPLOYEE, NOC_PENDING_EMPLOYEE],
      nocBlocked: [{
        employee_id: NOC_PENDING_EMPLOYEE.employee_id,
        employee_code: NOC_PENDING_EMPLOYEE.employee_code,
        employee_name: NOC_PENDING_EMPLOYEE.employee_name,
        net_salary: 30000,
        case_status: "in_progress",
        pending_stages: "Finance",
      }],
    });

    const { rows, excludedByNoc } = await getEligibleTransferRowsWithNocExclusions(RUN_ID);

    expect(rows.map((r) => r.employee_id)).toEqual([READY_EMPLOYEE.employee_id]);
    expect(excludedByNoc).toHaveLength(1);
    expect(excludedByNoc[0]).toMatchObject({
      employee_id: NOC_PENDING_EMPLOYEE.employee_id,
      employee_code: NOC_PENDING_EMPLOYEE.employee_code,
    });
    expect(excludedByNoc[0].reason).toMatch(/in progress/i);
  });

  it("does not withhold anyone this population had no NOC-blocked match for", async () => {
    mockReadinessReport([READY_EMPLOYEE.employee_id]);
    mockRun({ lines: [READY_EMPLOYEE], nocBlocked: [] });

    const { rows, excludedByNoc } = await getEligibleTransferRowsWithNocExclusions(RUN_ID);

    expect(rows).toHaveLength(1);
    expect(excludedByNoc).toEqual([]);
  });

  it("excludes nobody, and reports nobody excluded, when the kill switch is OFF", async () => {
    // Owner ruling 2026-09-12 shipped with the gate defaulting ON — see the flag's own default
    // ("An unset flag means the gate applies") — but this pins that turning it OFF genuinely
    // restores the exact pre-wiring behaviour rather than half-applying it.
    mockReadinessReport([READY_EMPLOYEE.employee_id, NOC_PENDING_EMPLOYEE.employee_id]);
    mockRun({ lines: [READY_EMPLOYEE, NOC_PENDING_EMPLOYEE], gateEnabled: false });

    const { rows, excludedByNoc } = await getEligibleTransferRowsWithNocExclusions(RUN_ID);

    expect(rows.map((r) => r.employee_id).sort()).toEqual(
      [READY_EMPLOYEE.employee_id, NOC_PENDING_EMPLOYEE.employee_id].sort(),
    );
    expect(excludedByNoc).toEqual([]);
  });

  it("names 'not raised' when the employee has no NOC case at all", async () => {
    mockReadinessReport([NOC_PENDING_EMPLOYEE.employee_id]);
    mockRun({
      lines: [NOC_PENDING_EMPLOYEE],
      nocBlocked: [{
        employee_id: NOC_PENDING_EMPLOYEE.employee_id,
        employee_code: NOC_PENDING_EMPLOYEE.employee_code,
        employee_name: NOC_PENDING_EMPLOYEE.employee_name,
        net_salary: 30000,
        case_status: null,
        pending_stages: null,
      }],
    });

    const { excludedByNoc } = await getEligibleTransferRowsWithNocExclusions(RUN_ID);

    expect(excludedByNoc[0].reason).toMatch(/has not been raised/i);
  });
});

describe("back-compat wrappers keep prior callers working", () => {
  it("getEligibleTransferRows returns only the row list — existing callers see no shape change", async () => {
    mockReadinessReport([READY_EMPLOYEE.employee_id, NOC_PENDING_EMPLOYEE.employee_id]);
    mockRun({
      lines: [READY_EMPLOYEE, NOC_PENDING_EMPLOYEE],
      nocBlocked: [{
        employee_id: NOC_PENDING_EMPLOYEE.employee_id,
        employee_code: NOC_PENDING_EMPLOYEE.employee_code,
        employee_name: NOC_PENDING_EMPLOYEE.employee_name,
        net_salary: 30000,
        case_status: "in_progress",
        pending_stages: null,
      }],
    });

    const rows = await getEligibleTransferRows(RUN_ID);

    // An array, not { rows, excludedByNoc } — generateSalaryTransferBatch and every other
    // existing caller does rows.length / rows.filter directly on the return value.
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.map((r) => r.employee_id)).toEqual([READY_EMPLOYEE.employee_id]);
  });

  it("getFilteredEligibleTransferRows applies the NOC exclusion before the branch/status filter", async () => {
    mockReadinessReport([READY_EMPLOYEE.employee_id, NOC_PENDING_EMPLOYEE.employee_id]);
    mockRun({
      lines: [READY_EMPLOYEE, NOC_PENDING_EMPLOYEE],
      nocBlocked: [{
        employee_id: NOC_PENDING_EMPLOYEE.employee_id,
        employee_code: NOC_PENDING_EMPLOYEE.employee_code,
        employee_name: NOC_PENDING_EMPLOYEE.employee_name,
        net_salary: 30000,
        case_status: "in_progress",
        pending_stages: null,
      }],
    });

    const rows = await getFilteredEligibleTransferRows(RUN_ID, { status: "both" });

    expect(rows.map((r) => r.employee_id)).toEqual([READY_EMPLOYEE.employee_id]);
  });

  it("getFilteredEligibleTransferRowsWithNocExclusions filters rows but keeps the full excluded list", async () => {
    mockReadinessReport([READY_EMPLOYEE.employee_id, NOC_PENDING_EMPLOYEE.employee_id]);
    mockRun({
      lines: [READY_EMPLOYEE, NOC_PENDING_EMPLOYEE],
      nocBlocked: [{
        employee_id: NOC_PENDING_EMPLOYEE.employee_id,
        employee_code: NOC_PENDING_EMPLOYEE.employee_code,
        employee_name: NOC_PENDING_EMPLOYEE.employee_name,
        net_salary: 30000,
        case_status: "in_progress",
        pending_stages: null,
      }],
    });

    // Filtering to branch_id that only READY_EMPLOYEE belongs to must not touch excludedByNoc:
    // the UI needs the whole withheld list regardless of which branch panel is open.
    const { rows, excludedByNoc } = await getFilteredEligibleTransferRowsWithNocExclusions(RUN_ID, {
      branchId: READY_EMPLOYEE.branch_id,
    });

    expect(rows.map((r) => r.employee_id)).toEqual([READY_EMPLOYEE.employee_id]);
    expect(excludedByNoc).toHaveLength(1);
  });
});
