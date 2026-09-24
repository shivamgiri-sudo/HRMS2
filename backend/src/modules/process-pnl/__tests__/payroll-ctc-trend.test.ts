import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * OWNER RULE (2026-09-24, final): People Cost = CTC paid − (Other deduction + Leave deduction) per
 * salary_prep_line (pnl-people-cost.ts), over EVERY salary_prep_run of the month (drafts included),
 * which is what the Live P&L tile (readPayroll) sums. CTC paid = gross + PF employer + ESIC employer
 * + gratuity; Other = other_deductions + loan_emi + advance_recovery; Leave = lwp_deduction.
 * Employee-side statutory deductions (pf_employee, professional_tax, tds) are NOT subtracted.
 *
 * The P&L trend used to sum gross_salary alone and to skip draft runs, so its bar for a month sat
 * below the tile for the same month. These tests run the readers' REAL SQL against an in-memory
 * SQLite database (node:sqlite), like payroll-single-cost-centre.test.ts.
 *
 * Fixture, 2026-05:
 *   E1 (process P1, branch B1) in FINALIZED run R1: gross 90,000 + PF 6,000 + ESIC 1,000 + gratuity 3,000 = 1,00,000
 *   E2 (process P1, branch B1) in DRAFT run R2:     gross 40,000 + PF 0 + ESIC 2,000 + gratuity 0      =   42,000
 *   E3 (process P1, branch B1) in FINALIZED run R1: gross 96,626 + PF 1,800 + gratuity 4,648, loan EMI
 *      20,000 (and employee PF 1,800 / PT 200 / TDS 500, which stay in) = 83,074
 *   People Cost total 2,25,074 (CTC 2,45,074 less the 20,000 loan EMI).
 */

type Sqlite = { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): unknown[] } };
let sqlite: Sqlite | null = null;
try {
  const mod = await import("node:sqlite" as string);
  sqlite = new mod.DatabaseSync(":memory:") as Sqlite;
} catch {
  sqlite = null;
}

const PAYROLL_SQL = /salary_prep_line|pnl_running_salary_snapshot|pnl_employee_cost_centre_override/;

/** mysql2 `query()` expands an array bound to `IN (?)`; do the same before handing SQL to SQLite. */
function expandArrays(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const out: unknown[] = [];
  let i = 0;
  const text = sql.replace(/\?/g, () => {
    const p = params[i++];
    if (Array.isArray(p)) {
      out.push(...p);
      return p.map(() => "?").join(",");
    }
    out.push(p === undefined ? null : p);
    return "?";
  });
  return { sql: text, params: out };
}

function run(sql: string, params: unknown[] = []): unknown[] {
  const db = sqlite!;
  if (/information_schema\.tables/i.test(sql)) {
    return db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`).all(String(params[0]));
  }
  if (/information_schema\.columns/i.test(sql)) {
    const table = String(params[0]).replace(/[^a-z0-9_]/gi, "");
    return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((c) => ({ column_name: c.name }));
  }
  // The trend's "real months" come from billing row counts; the fixture's one real month is 2026-05.
  if (/FROM billing_invoice_particular_snapshot\s+GROUP BY period_code/i.test(sql)) {
    return [{ period_code: "2026-05", n: 150 }];
  }
  const expanded = expandArrays(sql.replace(/COLLATE\s+utf8mb4_unicode_ci/gi, ""), params);
  try {
    return db.prepare(expanded.sql).all(...expanded.params);
  } catch (error) {
    if (PAYROLL_SQL.test(sql)) throw error;
    return [];
  }
}

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../pnl-trend-history.service.js", () => ({
  getDbBillHistory: vi.fn(async () => ({
    months: [], revenueRealRange: null, costRealRange: null, overlapRange: null, caveat: "test",
  })),
  getDbBillHistoryByProcess: vi.fn(async () => []),
}));
vi.mock("../../../shared/istDate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/istDate.js")>()),
  getCurrentDateIST: () => "2026-09-15",
}));

const SCHEMA = `
CREATE TABLE branch_master (id TEXT PRIMARY KEY, branch_name TEXT, active_status INT);
CREATE TABLE process_master (id TEXT PRIMARY KEY, process_name TEXT, active_status INT, branch_id TEXT);
CREATE TABLE cost_centre_master (id TEXT PRIMARY KEY, cost_centre_code TEXT, cost_centre_name TEXT, company_name TEXT,
  branch_id TEXT, process_id TEXT, active_status INT, process_name_bill TEXT, billing_client_name TEXT);
CREATE TABLE employees (id TEXT PRIMARY KEY, employee_code TEXT, full_name TEXT, branch_id TEXT,
  process_id TEXT, cost_centre_id TEXT, active_status INT, cost_center_code TEXT, designation_id TEXT);
CREATE TABLE designation_master (id TEXT PRIMARY KEY, designation_name TEXT);
CREATE TABLE salary_prep_run (id TEXT PRIMARY KEY, run_month TEXT, status TEXT, created_at TEXT);
CREATE TABLE salary_prep_line (id TEXT PRIMARY KEY, run_id TEXT, employee_id TEXT, gross_salary REAL,
  pf_employer REAL, esic_employer REAL, gratuity REAL, other_deductions REAL, loan_emi REAL,
  advance_recovery REAL, lwp_deduction REAL, pf_employee REAL, professional_tax REAL, tds REAL);
CREATE TABLE pnl_employee_cost_centre_override (id TEXT PRIMARY KEY, employee_id TEXT UNIQUE,
  target_cost_centre_id TEXT, active_status INT);

INSERT INTO branch_master VALUES ('B1','NOIDA',1);
INSERT INTO process_master VALUES ('P1','Onfido',1,'B1');
INSERT INTO cost_centre_master VALUES ('cc1','BSS/BO/NOIDA/576','Onfido','Mas Callnet India Pvt Ltd','B1','P1',1,NULL,NULL);
INSERT INTO employees (id, employee_code, full_name, branch_id, process_id, cost_centre_id, active_status) VALUES
  ('E1','E1','One','B1','P1','cc1',1), ('E2','E2','Two','B1','P1','cc1',1),
  ('E3','MAS47814','Three','B1','P1','cc1',1);
INSERT INTO salary_prep_run VALUES ('R1','2026-05','FINALIZED','2026-06-02'), ('R2','2026-05','draft','2026-06-03');
INSERT INTO salary_prep_line (id, run_id, employee_id, gross_salary, pf_employer, esic_employer, gratuity) VALUES
  ('L1','R1','E1',90000,6000,1000,3000),
  ('L2','R2','E2',40000,0,2000,NULL);
INSERT INTO salary_prep_line VALUES
  ('L3','R1','E3',96626,1800,0,4648,0,20000,0,0,1800,200,500);
`;

const PEOPLE_COST_TOTAL = 225074;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("P&L people cost = CTC paid less other and leave deductions (owner rule 2026-09-24)", () => {
  it("trend sums CTC less loan EMI / other / advance / LWP, drafts included", async () => {
    const { getPnlTrend } = await import("../pnl-trend.service.js");
    const out = await getPnlTrend();
    const may = out.company.find((m) => m.period === "2026-05");
    expect(may?.cost, "CTC less the 20,000 loan EMI, and the draft run counts").toBe(PEOPLE_COST_TOTAL);
    expect(may?.headcount).toBe(3);
    const p1 = out.processes.find((p) => p.processId === "P1")?.months.find((m) => m.period === "2026-05");
    expect(p1?.cost).toBe(PEOPLE_COST_TOTAL);
  });

  it("branch-filtered trend uses the same People Cost sum", async () => {
    const { getPnlTrend } = await import("../pnl-trend.service.js");
    const out = await getPnlTrend({ branchId: "B1" });
    expect(out.company.find((m) => m.period === "2026-05")?.cost).toBe(PEOPLE_COST_TOTAL);
  });

  it("trend equals the Live P&L tile (readPayroll) for the same month", async () => {
    const { getPnlTrend } = await import("../pnl-trend.service.js");
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const tile = (await getPnlReconciliation("2026-05", { asOfDate: "2026-09-15" })).totals.payrollCost;
    const trend = (await getPnlTrend()).company.find((m) => m.period === "2026-05")?.cost;
    expect(tile).toBe(PEOPLE_COST_TOTAL);
    expect(trend).toBe(tile);
  });

  it("the people drilldown (list and aggregated) totals equal the tile", async () => {
    const { getPnlDrilldown } = await import("../pnl-drilldown.service.js");
    const list = await getPnlDrilldown({ metric: "people", period: "2026-05", branchId: "B1" });
    const grouped = await getPnlDrilldown({ metric: "people", period: "2026-05", branchId: "B1", aggregatePeople: true });
    expect(list.total).toBe(PEOPLE_COST_TOTAL);
    expect(grouped.total).toBe(PEOPLE_COST_TOTAL);
    const mas47814 = list.rows.find((r) => r.label.includes("MAS47814") || String(r.detail ?? "").includes("MAS47814"));
    expect(mas47814?.amount, "loan EMI 20,000 is inside the person's people cost").toBe(83074);
  });

  it("cost-centre activity salary follows the same rule (gratuity included, NULL-safe)", async () => {
    const { getCostCentreActivity } = await import("../cost-centre-activity.service.js");
    const rows = await getCostCentreActivity("2026-05");
    const cc1 = rows.find((r) => r.costCentreId === "cc1");
    expect(cc1?.salaryCost).toBe(PEOPLE_COST_TOTAL);
    expect(cc1?.peoplePaid).toBe(3);
  });
});
