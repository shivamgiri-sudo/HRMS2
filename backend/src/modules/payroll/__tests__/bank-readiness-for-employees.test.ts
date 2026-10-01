import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * buildBankReadinessForEmployees must classify an employee exactly as the org-wide
 * buildBankReadinessReport(null) does. The Payroll Head salary review used the org-wide report
 * (every active employee + two full scans of db_bill's salary history) on every load and after
 * every action; it now asks for the employees on screen only. Same answer, far less work.
 *
 * The fixture covers each input the classifier reads from outside the employee's own row:
 * an account shared with another employee (duplicate), a confirmed credit in the verification
 * month, a credit confirmed only in an earlier month, and no bank record at all.
 */

const { query, billQuery } = vi.hoisted(() => ({ query: vi.fn(), billQuery: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute: query } }));
vi.mock("../../../db/billDb.js", () => ({ billQuery }));

import {
  buildBankReadinessReport,
  buildBankReadinessForEmployees,
  resetBankReadinessCachesForTests,
} from "../bank-payment-readiness.service.js";

type Emp = { id: string; code: string; account: string | null };
const EMPLOYEES: Emp[] = [
  { id: "e1", code: "MAS1", account: "111122223333" }, // shares an account with e2
  { id: "e2", code: "MAS2", account: "111122223333" },
  { id: "e3", code: "MAS3", account: "444455556666" }, // confirmed credit this month
  { id: "e4", code: "MAS4", account: "777788889999" }, // confirmed only in an earlier month
  { id: "e5", code: "MAS5", account: null },           // no bank record
];
const MONTH = "2026-08-01";
const MONTH_ROWS = [
  { EmpCode: "MAS3", AcNo: "444455556666", SalaryReceiveStatus: "YES" },
  { EmpCode: "MAS4", AcNo: "777788889999", SalaryReceiveStatus: "NO" },
];
const EVER_CONFIRMED = [
  { EmpCode: "MAS3", AcNo: "444455556666" },
  { EmpCode: "MAS4", AcNo: "777788889999" },
];

function employeeRow(e: Emp) {
  return {
    employee_id: e.id,
    employee_code: e.code,
    employee_name: `Name ${e.code}`,
    branch_id: "b1",
    branch_name: "Noida",
    official_email: `${e.code}@x.in`,
    personal_email: null,
    legacy_employee_column_account: null,
    bank_detail_id: e.account ? `bd-${e.id}` : null,
    account_number_enc: null,
    account_number_legacy: e.account,
    ifsc_code: e.account ? "HDFC0000001" : null,
    bank_name: e.account ? "HDFC Bank" : null,
    account_holder_name: e.account ? `Name ${e.code}` : null,
    active_primary_count: e.account ? 1 : 0,
    open_change_requests: 0,
  };
}

beforeEach(() => {
  resetBankReadinessCachesForTests();
  query.mockReset();
  billQuery.mockReset();
  query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/e\.id IN \(\?\)/.test(sql)) {
      const ids = (params?.[0] as string[]) ?? [];
      return [EMPLOYEES.filter((e) => ids.includes(e.id)).map(employeeRow)];
    }
    if (/JOIN employee_bank_detail ebd/.test(sql) && !/LEFT JOIN employee_bank_detail/.test(sql)) {
      return [EMPLOYEES.filter((e) => e.account).map((e) => ({
        employee_code: e.code, account_number_enc: null, account_number_legacy: e.account,
      }))];
    }
    return [EMPLOYEES.map(employeeRow)];
  });
  billQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/GROUP BY SalDate/.test(sql)) return [{ SalDate: MONTH, n: 2 }];
    const codes = /EmpCode IN/.test(sql) ? params.filter((p) => p !== MONTH) : null;
    const keep = (r: { EmpCode: string }) => !codes || codes.includes(r.EmpCode);
    if (/SalDate = \?/.test(sql)) return MONTH_ROWS.filter(keep);
    if (/SELECT DISTINCT EmpCode, AcNo/.test(sql)) return EVER_CONFIRMED.filter(keep);
    throw new Error(`unexpected billQuery: ${sql}`);
  });
});

describe("buildBankReadinessForEmployees", () => {
  it("classifies each employee exactly as the org-wide report does", async () => {
    const orgWide = await buildBankReadinessReport(null);
    const targets = ["e1", "e3", "e4", "e5"];
    const scoped = await buildBankReadinessForEmployees(targets);

    const strip = (r: Record<string, unknown>) => {
      const { as_of: _a, ...rest } = r as Record<string, unknown> & { as_of?: unknown };
      return rest;
    };
    const expected = orgWide.rows.filter((r) => targets.includes(r.employee_id)).map(strip);
    expect(scoped.rows.map(strip)).toEqual(expected);
    expect(scoped.rows).toHaveLength(4);
  });

  it("still sees a duplicate account held by an employee who was not asked for", async () => {
    const scoped = await buildBankReadinessForEmployees(["e1"]);
    const orgWide = await buildBankReadinessReport(null);
    expect(scoped.rows[0]).toEqual(orgWide.rows.find((r) => r.employee_id === "e1"));
    expect(JSON.stringify(scoped.rows[0])).toContain("MAS2");
  });

  it("asks db_bill only about the requested employees", async () => {
    await buildBankReadinessForEmployees(["e3"]);
    const creditCalls = billQuery.mock.calls.filter(([sql]) => !/GROUP BY SalDate/.test(String(sql)));
    expect(creditCalls.length).toBe(2);
    for (const [sql, params] of creditCalls) {
      expect(String(sql)).toMatch(/EmpCode IN \(\?\)/);
      expect(params).toContain("MAS3");
      expect(params).not.toContain("MAS4");
    }
  });

  it("returns nothing, without querying, for an empty list", async () => {
    const scoped = await buildBankReadinessForEmployees([]);
    expect(scoped.rows).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    expect(billQuery).not.toHaveBeenCalled();
  });
  it("remembers credits, so reopening the same employees does not go back to db_bill", async () => {
    const first = await buildBankReadinessForEmployees(["e3", "e4"]);
    const callsAfterFirst = billQuery.mock.calls.length;
    const second = await buildBankReadinessForEmployees(["e3", "e4"]);
    expect(billQuery.mock.calls.length).toBe(callsAfterFirst);
    expect(second.rows).toEqual(first.rows);
  });

  it("degrades to unverifiable instead of waiting on a slow db_bill", async () => {
    vi.useFakeTimers();
    try {
      billQuery.mockImplementation(async (sql: string) => {
        if (/GROUP BY SalDate/.test(sql)) return [{ SalDate: MONTH, n: 2 }];
        return new Promise(() => {}); // never answers
      });
      const pending = buildBankReadinessForEmployees(["e3"]);
      await vi.advanceTimersByTimeAsync(5000);
      const scoped = await pending;
      expect(scoped.verification_source.available).toBe(false);
      expect(scoped.verification_source.error).toMatch(/exceeded/);
      expect(scoped.rows).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
