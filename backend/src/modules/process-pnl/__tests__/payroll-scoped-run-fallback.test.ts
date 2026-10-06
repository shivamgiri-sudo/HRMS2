import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A payroll run can cover chosen cost centres (salary_prep_run_scope, migration 1671). Until a
 * cost centre is run, its people cost is the running-salary accrual. P&L used to switch source for
 * the WHOLE company the moment any run had lines, so one scoped run zeroed everyone else's payroll.
 * Rule now: run lines for covered staff + snapshot accrual for staff whose cost centre no valid
 * (non-void) run covers that month. Real SQL on in-memory SQLite (same fixture as
 * payroll-single-cost-centre.test.ts, plus month 2026-07).
 *
 *   2026-07 expected: E2 posted 50,000 (not its 45,000 accrual) + E1 100,000 (mapped to 576)
 *                     + E3 20,000 (no cost centre) + E4 30,000 = 2,00,000 company.
 */

type Sqlite = { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): unknown[] } };
let sqlite: Sqlite | null = null;
try {
  // node:sqlite ships with Node 22.5+; on an older runtime these tests are skipped, not failed.
  const mod = await import("node:sqlite" as string);
  sqlite = new mod.DatabaseSync(":memory:") as Sqlite;
} catch {
  sqlite = null;
}

const PAYROLL_SQL = /salary_prep_line|pnl_running_salary_snapshot|pnl_employee_cost_centre_override/;

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
  const text = sql.replace(/COLLATE\s+utf8mb4_unicode_ci/gi, "");
  try {
    return db.prepare(text).all(...params.map((p) => (p === undefined ? null : p)));
  } catch (error) {
    // Non-payroll reads (revenue, GRN, seat billing...) use MySQL-only syntax; they are irrelevant
    // here and read as empty. A PAYROLL read that fails must fail the test, never read as zero.
    if (PAYROLL_SQL.test(sql)) throw error;
    return [];
  }
}

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../../../shared/istDate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/istDate.js")>()),
  getCurrentDateIST: () => "2026-09-15",
}));

const SCHEMA = `
CREATE TABLE branch_master (id TEXT PRIMARY KEY, branch_name TEXT, active_status INT);
CREATE TABLE process_master (id TEXT PRIMARY KEY, process_name TEXT, active_status INT, branch_id TEXT);
CREATE TABLE cost_centre_master (id TEXT PRIMARY KEY, cost_centre_code TEXT, cost_centre_name TEXT, company_name TEXT,
  branch_id TEXT, process_id TEXT, active_status INT, process_name_bill TEXT, billing_client_name TEXT);
CREATE TABLE designation_master (id TEXT PRIMARY KEY, designation_name TEXT);
CREATE TABLE department_master (id TEXT PRIMARY KEY, dept_name TEXT);
CREATE TABLE employees (id TEXT PRIMARY KEY, employee_code TEXT, full_name TEXT, cost_center_code TEXT, branch_id TEXT,
  process_id TEXT, cost_centre_id TEXT, designation_id TEXT, department_id TEXT, active_status INT);
CREATE TABLE salary_prep_run (id TEXT PRIMARY KEY, run_month TEXT, status TEXT, created_at TEXT,
  disbursed_at TEXT, auto_closed_at TEXT, finance_approved_at TEXT, updated_at TEXT);
CREATE TABLE salary_prep_line (id TEXT PRIMARY KEY, run_id TEXT, employee_id TEXT, gross_salary REAL,
  pf_employer REAL, esic_employer REAL, gratuity REAL, other_deductions REAL DEFAULT 0, loan_emi REAL DEFAULT 0,
  advance_recovery REAL DEFAULT 0, lwp_deduction REAL DEFAULT 0, incentive_total REAL DEFAULT 0);
CREATE TABLE pnl_employee_cost_centre_override (id TEXT PRIMARY KEY, employee_id TEXT UNIQUE,
  target_cost_centre_id TEXT, active_status INT);
CREATE TABLE pnl_running_salary_snapshot (id TEXT PRIMARY KEY, period_code TEXT, employee_id TEXT, employee_code TEXT,
  branch_id TEXT, process_id TEXT, cost_centre_id TEXT, department_name TEXT, designation_name TEXT, pnl_bucket TEXT,
  earned_salary_till_date REAL, gross_monthly REAL, earned_payable_days REAL, total_payable_days REAL,
  as_of_date TEXT, computed_at TEXT);
CREATE TABLE pnl_cost_classification_rule (scope_type TEXT, scope_key TEXT, process_id TEXT, branch_id TEXT,
  pnl_bucket TEXT, priority INT, active_status INT, effective_from TEXT, effective_to TEXT, created_at TEXT);

INSERT INTO branch_master VALUES ('B1','NOIDA',1), ('B2','NOIDA-2',1);
INSERT INTO process_master VALUES ('P576','Onfido',1,'B1'), ('P100','Inbound',1,'B1'), ('P577','Back Office',1,'B2');
INSERT INTO cost_centre_master VALUES
  ('cc576','BSS/BO/NOIDA/576','Onfido','Mas Callnet India Pvt Ltd','B1','P576',1,NULL,NULL),
  ('cc100','BSS/IB/NOIDA/100','Inbound','Mas Callnet India Pvt Ltd','B1','P100',1,NULL,NULL),
  ('cc577','BSS/BO/NOIDA-2/577','Back office pool','Mas Callnet India Pvt Ltd','B2','P577',1,NULL,NULL);
INSERT INTO designation_master VALUES ('D1','EXECUTIVE');
INSERT INTO department_master VALUES ('DEP1','OPERATIONS');
INSERT INTO employees VALUES
  ('E1','E1','One','BSS/BO/NOIDA-2/577','B2','P577','cc577','D1','DEP1',1),
  ('E2','E2','Two','BSS/IB/NOIDA/100','B1','P100','cc100','D1','DEP1',1),
  ('E3','E3','Three',NULL,'B2',NULL,NULL,'D1','DEP1',1),
  ('E4','E4','Four','BSS/BO/NOIDA-2/577','B2','P577','cc577','D1','DEP1',1);
INSERT INTO pnl_employee_cost_centre_override VALUES ('o1','E1','cc576',1), ('o4','E4','cc100',0);
INSERT INTO salary_prep_run VALUES ('R1','2026-05','FINALIZED','2026-06-02',NULL,NULL,NULL,'2026-06-02');
INSERT INTO salary_prep_line (id, run_id, employee_id, gross_salary, pf_employer, esic_employer, gratuity) VALUES
  ('L1','R1','E1',90000,6000,0,4000), ('L2','R1','E2',50000,0,0,0),
  ('L3','R1','E3',20000,0,0,0), ('L4','R1','E4',30000,0,0,0);
INSERT INTO pnl_running_salary_snapshot VALUES
  ('S1a','2026-06','E1','E1','B2','P577','cc577','OPERATIONS','EXECUTIVE','agent_salary',60000,0,0,0,'2026-06-20','x'),
  ('S1b','2026-06','E1','E1','B2','P577','cc100','OPERATIONS','EXECUTIVE','agent_salary',40000,0,0,0,'2026-06-20','x'),
  ('S2','2026-06','E2','E2','B1','P100','cc100','OPERATIONS','EXECUTIVE','agent_salary',50000,0,0,0,'2026-06-20','x'),
  ('S3','2026-06','E3','E3','B2',NULL,NULL,'OPERATIONS','EXECUTIVE','bmc_people',20000,0,0,0,'2026-06-20','x'),
  ('S4','2026-06','E4','E4','B2','P577','cc577','OPERATIONS','EXECUTIVE','agent_salary',30000,0,0,0,'2026-06-20','x');
CREATE TABLE salary_prep_run_scope (id TEXT PRIMARY KEY, run_id TEXT, run_month TEXT, branch_id TEXT, cost_centre_id TEXT);
-- 2026-07: a scoped run R2 has paid cost centre 100 only (E2, 50,000). R3 is a CANCELLED company-wide run.
-- Snapshot holds everyone; E2's accrual (45,000) must NOT be counted on top of the posted 50,000.
INSERT INTO salary_prep_run VALUES ('R2','2026-07','FINALIZED','2026-08-02',NULL,NULL,NULL,'2026-08-02'),
  ('R3','2026-07','cancelled','2026-08-01',NULL,NULL,NULL,'2026-08-01');
INSERT INTO salary_prep_run_scope VALUES ('sc1','R2','2026-07','B1','cc100');
INSERT INTO salary_prep_line (id, run_id, employee_id, gross_salary, pf_employer, esic_employer, gratuity) VALUES
  ('L5','R2','E2',50000,0,0,0), ('L6','R3','E1',1,0,0,0);
INSERT INTO pnl_running_salary_snapshot VALUES
  ('T1','2026-07','E1','E1','B2','P577','cc577','OPERATIONS','EXECUTIVE','agent_salary',100000,0,0,0,'2026-07-20','x'),
  ('T2','2026-07','E2','E2','B1','P100','cc100','OPERATIONS','EXECUTIVE','agent_salary',45000,0,0,0,'2026-07-20','x'),
  ('T3','2026-07','E3','E3','B2',NULL,NULL,'OPERATIONS','EXECUTIVE','bmc_people',20000,0,0,0,'2026-07-20','x'),
  ('T4','2026-07','E4','E4','B2','P577','cc577','OPERATIONS','EXECUTIVE','agent_salary',30000,0,0,0,'2026-07-20','x');
-- Rule scoped to HR branch NOIDA-2: classification follows who the person is (home branch).
INSERT INTO pnl_cost_classification_rule VALUES ('department','OPERATIONS',NULL,'B2','dsc_people',1,1,'2000-01-01',NULL,'2000-01-01');
`;

const PERIOD = "2026-07";
const bucketSum = (b?: Record<string, number>) => (b ? Object.values(b).reduce((t, v) => t + v, 0) : 0);

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("scoped payroll run: uncovered cost centres keep their accrual", () => {
  it("Live P&L: run lines for cost centre 100, accrual for everyone else", async () => {
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation(PERIOD, { asOfDate: "2026-09-15" });
    const pay = (cc: string) => out.rows.find((r) => r.costCentreId === cc)?.payrollCost ?? 0;
    expect(pay("cc100"), "posted, not accrued").toBe(50000);
    expect(pay("cc576"), "E1 accrual, mapped").toBe(100000);
    expect(pay("cc577")).toBe(30000);
    expect(out.totals.payrollCost, "E3 (no cost centre) accrual included once").toBe(200000);
  });

  it("CEO Overview: same split per branch", async () => {
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    const all = await getCeoOverview(PERIOD);
    const people = (id: string) => all.branches.find((b) => b.branchId === id)?.peopleCost ?? 0;
    expect(people("B1"), "E2 posted + E1 accrual (mapped)").toBe(150000);
    expect(people("B2"), "E3 + E4 accrual").toBe(50000);
    expect(all.peopleCost).toBe(200000);
  });

  it("Statement people cost: actual for covered, running for uncovered", async () => {
    const { getStatementPeopleCost } = await import("../pnl-statement.service.js");
    const out = await getStatementPeopleCost(PERIOD);
    expect(bucketSum(out.byBranch.get("B1"))).toBe(150000);
    expect(bucketSum(out.byBranch.get("B2"))).toBe(50000);
  });

  it("people drilldown ties to the tiles", async () => {
    const { getPnlDrilldown } = await import("../pnl-drilldown.service.js");
    const total = async (scope: Record<string, string>) => (await getPnlDrilldown({ metric: "people", period: PERIOD, ...scope })).total;
    expect(await total({ costCentreId: "cc100" })).toBe(50000);
    expect(await total({ branchId: "B1" })).toBe(150000);
    expect(await total({ branchId: "B2" })).toBe(50000);
  });
});
