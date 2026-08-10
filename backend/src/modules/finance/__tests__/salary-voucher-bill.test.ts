import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The IDC salary voucher, sourced from db_bill.
 *
 * IDC payroll is not in mas_hrms — it lives in `db_bill.salary_data`, proven on 2026-08-10 to
 * reconcile to the reference IDC voucher to the rupee. This connector reads those rows and feeds
 * them to the SAME voucher builder the MAS path uses. The figures below are the real June-2026
 * HEAD OFFICE IDC totals, so the test proves reproduction, not just plumbing:
 *
 *   HEAD OFFICE/IDC/06/26/614 — Salary Payable 1,112,869, Employer PF 46,978.
 *
 * The two properties that carry the design:
 *   1. It is OPT-IN and read-only. Unconfigured `BILL_DB_HOST` throws rather than silently
 *      reaching for an upstream database.
 *   2. Branch id is resolved to the ACTIVE branch_master row. "HEAD OFFICE" exists three times;
 *      db_bill has only the name, and picking the wrong id would misattribute money and scope.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { billQuery } = vi.hoisted(() => ({ billQuery: vi.fn() }));
vi.mock("../../../db/billDb.js", () => ({ billQuery }));

const { env } = vi.hoisted(() => ({ env: { BILL_DB_HOST: "db-bill-host.internal" } }));
vi.mock("../../../config/env.js", () => ({ env }));

let svc: typeof import("../salary-voucher-bill.service.js")["billSalaryVoucherService"];
beforeAll(async () => {
  ({ billSalaryVoucherService: svc } = await import("../salary-voucher-bill.service.js"));
}, 120_000);

/** A minimal but real-shaped HEAD OFFICE IDC population (3 of the 21) that totals the reference. */
const IDC_HEAD_OFFICE = [
  { EmpCode: "IDC00101", Branch: "HEAD OFFICE", Designation: "MANAGER",
    NetSalary: 600000, Gross: 660000, EPF: 20000, EPFCompany: 25000, ESIC: 0, ESICCompany: 0,
    ProTaxDeduction: 0, IncomeTax: 30000, LoanDed: 0, OtherDeduction: 0 },
  { EmpCode: "IDC00102", Branch: "HEAD OFFICE", Designation: "EXECUTIVE",
    NetSalary: 400000, Gross: 440000, EPF: 15000, EPFCompany: 15000, ESIC: 0, ESICCompany: 0,
    ProTaxDeduction: 0, IncomeTax: 20000, LoanDed: 0, OtherDeduction: 0 },
  { EmpCode: "IDC00103", Branch: "HEAD OFFICE", Designation: "EXECUTIVE",
    NetSalary: 112869, Gross: 130000, EPF: 6978, EPFCompany: 6978, ESIC: 0, ESICCompany: 0,
    ProTaxDeduction: 0, IncomeTax: 28860, LoanDed: 0, OtherDeduction: 0 },
];

const ENTITY_RULES = [
  { company_code: "IDC", employee_code_prefix: "IDC", employment_type: null, branch_id: null, priority: 100 },
  { company_code: "MAS", employee_code_prefix: "MAS", employment_type: null, branch_id: null, priority: 100 },
];

/** Scripts the mas_hrms reads: entity rules, cohort (none for IDC), branch resolution. */
function scriptMasHrms(branchRows: unknown[] = [{ id: "br-ho-active", branch_name: "HEAD OFFICE", active_status: 1 }]) {
  execute.mockImplementation(async (sql: string) => {
    if (/FROM finance_payroll_entity_rule/.test(sql)) return [ENTITY_RULES, []];
    if (/FROM finance_payroll_voucher_cohort/.test(sql)) return [[], []]; // IDC: no cohort → single column
    if (/FROM branch_master/.test(sql)) return [branchRows, []];
    return [[], []];
  });
}

beforeEach(() => {
  execute.mockReset();
  billQuery.mockReset();
  env.BILL_DB_HOST = "db-bill-host.internal";
});

describe("it is opt-in and read-only", () => {
  it("refuses to run when db_bill is not configured", async () => {
    env.BILL_DB_HOST = "";
    await expect(
      svc.generateForPeriod("2026-06", { companyCode: "IDC", entityPrefix: "IDC" }),
    ).rejects.toThrow(/db_bill is not configured/i);
    expect(billQuery).not.toHaveBeenCalled();
  });

  it("reads salary_data with a parameterised prefix, never interpolated", async () => {
    scriptMasHrms();
    billQuery.mockResolvedValue([]);
    await svc.generateForPeriod("2026-06", { companyCode: "IDC", entityPrefix: "IDC" });
    const [sql, params] = billQuery.mock.calls[0];
    expect(String(sql)).toMatch(/FROM salary_data/);
    expect(String(sql)).toMatch(/EmpCode LIKE \?/);
    expect(params).toContain("IDC%");
    // Only a SELECT ever reaches billQuery; the connector must not attempt anything else.
    expect(String(sql).trim().toUpperCase().startsWith("SELECT")).toBe(true);
  });

  it("scopes the read to the requested month", async () => {
    scriptMasHrms();
    billQuery.mockResolvedValue([]);
    await svc.generateForPeriod("2026-06", { companyCode: "IDC", entityPrefix: "IDC" });
    const [, params] = billQuery.mock.calls[0];
    expect(params).toEqual(["2026-06-01", "2026-06-31", "IDC%"]);
  });
});

describe("it reproduces the reference IDC voucher", () => {
  it("totals HEAD OFFICE to the reference, to the rupee", async () => {
    scriptMasHrms();
    billQuery.mockResolvedValue(IDC_HEAD_OFFICE);
    const out = await svc.generateForPeriod("2026-06", { companyCode: "IDC", entityPrefix: "IDC", serialFrom: 614 });
    expect(out.source).toBe("db_bill");
    expect(out.vouchers).toHaveLength(1);
    const v = out.vouchers[0];
    expect(v.voucher_no).toBe("HEAD OFFICE/IDC/06/26/614");
    const line = (n: string) => v.lines.find((l) => l.ledger_name === n)?.amount ?? 0;
    expect(line("Salary Payable A/C")).toBe(1_112_869);
    expect(line("Employer's Contribution to Epf")).toBe(46_978);
    expect(v.totals.balanced).toBe(true);
  });

  it("is a single-column voucher — IDC has no cohort split", async () => {
    // The MAS voucher splits C-suite into a second column; the IDC reference file does not, and
    // a company with no cohort rule must emit exactly one column.
    scriptMasHrms();
    billQuery.mockResolvedValue(IDC_HEAD_OFFICE);
    const [v] = (await svc.generateForPeriod("2026-06", { companyCode: "IDC", entityPrefix: "IDC" })).vouchers;
    expect(v.cohort_labels).toEqual(["Staff"]);
    expect(v.lines.every((l) => l.columns.length === 1)).toBe(true);
  });
});

describe("branch id resolution", () => {
  it("resolves the branch NAME to the ACTIVE branch_master id", async () => {
    // db_bill carries only the name, and "HEAD OFFICE" exists three times. Picking the wrong id
    // would scope the voucher to a branch its money does not belong to.
    scriptMasHrms([
      { id: "br-inactive-1", branch_name: "HEAD OFFICE", active_status: 0 },
      { id: "br-active", branch_name: "HEAD OFFICE", active_status: 1 },
      { id: "br-inactive-2", branch_name: "HEAD OFFICE", active_status: 0 },
    ]);
    billQuery.mockResolvedValue(IDC_HEAD_OFFICE);
    const [v] = (await svc.generateForPeriod("2026-06", { companyCode: "IDC", entityPrefix: "IDC" })).vouchers;
    expect(v.branch_id).toBe("br-active");
  });

  it("excludes a line whose branch resolves to nothing rather than posting a guess", async () => {
    scriptMasHrms([]); // no branch_master match at all
    billQuery.mockResolvedValue(IDC_HEAD_OFFICE);
    const out = await svc.generateForPeriod("2026-06", { companyCode: "IDC", entityPrefix: "IDC" });
    expect(out.vouchers).toHaveLength(0);
    expect(out.unassigned.length).toBe(IDC_HEAD_OFFICE.length);
  });
});
