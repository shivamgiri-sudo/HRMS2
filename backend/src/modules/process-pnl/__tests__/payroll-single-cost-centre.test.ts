import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * OWNER RULE (2026-09-23): an employee mapped to a payroll cost centre
 * (pnl_employee_cost_centre_override) has their salary counted in the MAPPED cost centre only —
 * never in their home cost centre or home branch, and never in two places — on every surface.
 *
 * These tests run the readers' REAL generated SQL against an in-memory SQLite database (node:sqlite)
 * seeded with one small payroll, so what is pinned is the actual attribution the SQL performs, not
 * the shape of a mocked query. Readers covered: Live P&L (readPayroll / readUnallocatedPayroll via
 * getPnlReconciliation), CEO Overview (peopleByBranch), the Statement's actual-payroll path
 * (getActualPeopleCost) and running-salary path (getRunningPeopleCost), and the people drilldown.
 *
 * Fixture (all MAS Callnet):
 *   NOIDA   (B1): cost centres 576 (process Onfido) and 100 (process Inbound)
 *   NOIDA-2 (B2): cost centre 577 (process Back Office)
 *   E1  HR: B2 / 577 / Back Office, MAPPED to 576          posted 1,00,000
 *   E2  HR: B1 / 100 / Inbound                            posted   50,000
 *   E3  HR: B2, no cost centre, no process                posted   20,000
 *   E4  HR: B2 / 577, mapping to 100 DEACTIVATED           posted   30,000
 * 2026-05 has posted payroll; 2026-06 has only the running-salary snapshot, where E1 has two rows
 * (a mid-month HR transfer 577 -> 100: 60,000 + 40,000) that must BOTH fold into 576.
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
  pf_employer REAL, esic_employer REAL, gratuity REAL);
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
INSERT INTO salary_prep_line VALUES
  ('L1','R1','E1',90000,6000,0,4000), ('L2','R1','E2',50000,0,0,0),
  ('L3','R1','E3',20000,0,0,0), ('L4','R1','E4',30000,0,0,0);
INSERT INTO pnl_running_salary_snapshot VALUES
  ('S1a','2026-06','E1','E1','B2','P577','cc577','OPERATIONS','EXECUTIVE','agent_salary',60000,0,0,0,'2026-06-20','x'),
  ('S1b','2026-06','E1','E1','B2','P577','cc100','OPERATIONS','EXECUTIVE','agent_salary',40000,0,0,0,'2026-06-20','x'),
  ('S2','2026-06','E2','E2','B1','P100','cc100','OPERATIONS','EXECUTIVE','agent_salary',50000,0,0,0,'2026-06-20','x'),
  ('S3','2026-06','E3','E3','B2',NULL,NULL,'OPERATIONS','EXECUTIVE','bmc_people',20000,0,0,0,'2026-06-20','x'),
  ('S4','2026-06','E4','E4','B2','P577','cc577','OPERATIONS','EXECUTIVE','agent_salary',30000,0,0,0,'2026-06-20','x');
-- Rule scoped to HR branch NOIDA-2: classification follows who the person is (home branch).
INSERT INTO pnl_cost_classification_rule VALUES ('department','OPERATIONS',NULL,'B2','dsc_people',1,1,'2000-01-01',NULL,'2000-01-01');
`;

const TOTAL = 200000;
const bucketSum = (b?: Record<string, number>) => (b ? Object.values(b).reduce((t, v) => t + v, 0) : 0);

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("payroll counted in the mapped cost centre only (owner rule 2026-09-23)", () => {
  it("Statement, actual payroll: a mapped employee is in the mapped branch AND process only", async () => {
    const { getActualPeopleCost } = await import("../bpo-pnl.service.js");
    const out = await getActualPeopleCost("2026-05");

    expect(bucketSum(out.byBranch.get("B1")), "NOIDA = E1 (mapped to 576) + E2").toBe(150000);
    expect(bucketSum(out.byBranch.get("B2")), "NOIDA-2 = E3 + E4, never E1").toBe(50000);
    expect([...out.byBranch.values()].reduce((t, b) => t + bucketSum(b), 0), "each rupee once").toBe(TOTAL);

    expect(bucketSum(out.byProcess.get("P576")), "E1 under the mapped cost centre's process").toBe(100000);
    expect(bucketSum(out.byProcess.get("P577")), "Back Office keeps only E4").toBe(30000);
    expect(bucketSum(out.byProcess.get("P100"))).toBe(50000);

    // Classification follows the HOME branch rule (NOIDA-2 OPERATIONS -> DSC), even though E1's
    // pay now counts in NOIDA — the mapping moves money, it does not reclassify people.
    expect(out.byProcess.get("P576")?.dsc_people).toBe(100000);
    expect(out.coverageByBranch.get("B1")?.activeEmployees).toBe(2);
    expect(out.coverageByBranch.get("B2")?.activeEmployees).toBe(2);
  });

  it("Statement, running salary: every snapshot row of a mapped employee folds into the mapped cost centre", async () => {
    const { getRunningPeopleCost } = await import("../pnl-running-salary.service.js");
    const out = await getRunningPeopleCost("2026-06");
    expect(bucketSum(out.byBranch.get("B1")), "E1's 577 AND 100 rows both land on 576 (NOIDA)").toBe(150000);
    expect(bucketSum(out.byBranch.get("B2"))).toBe(50000);
    expect(bucketSum(out.byProcess.get("P576"))).toBe(100000);
    expect(bucketSum(out.byProcess.get("P100")), "E1's transfer row is not in Inbound").toBe(50000);
    expect(bucketSum(out.byProcess.get("P577"))).toBe(30000);
    expect([...out.byBranch.values()].reduce((t, b) => t + bucketSum(b), 0)).toBe(TOTAL);
  });

  it("CEO Overview: branch rows and process scope put a mapped employee in one place", async () => {
    const { getCeoOverview } = await import("../ceo-overview.service.js");
    for (const period of ["2026-05", "2026-06"]) {
      const all = await getCeoOverview(period);
      const people = (id: string) => all.branches.find((b) => b.branchId === id)?.peopleCost ?? 0;
      expect(people("B1"), `${period} NOIDA`).toBe(150000);
      expect(people("B2"), `${period} NOIDA-2`).toBe(50000);
      expect(all.peopleCost, `${period} company`).toBe(TOTAL);

      expect((await getCeoOverview(period, { processId: "P576" })).peopleCost, `${period} Onfido`).toBe(100000);
      expect((await getCeoOverview(period, { processId: "P577" })).peopleCost, `${period} Back Office`).toBe(30000);
      expect((await getCeoOverview(period, { costCentreId: "cc577" })).peopleCost, `${period} 577`).toBe(30000);
      expect((await getCeoOverview(period, { costCentreId: "cc576" })).peopleCost, `${period} 576`).toBe(100000);
    }
  });

  it("Live P&L: the mapped cost centre's row carries the pay; the home one does not", async () => {
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    for (const period of ["2026-05", "2026-06"]) {
      const out = await getPnlReconciliation(period, { asOfDate: "2026-09-15" });
      const pay = (cc: string) => out.rows.find((r) => r.costCentreId === cc)?.payrollCost ?? 0;
      expect(pay("cc576"), `${period} 576`).toBe(100000);
      expect(pay("cc577"), `${period} 577`).toBe(30000);
      expect(pay("cc100"), `${period} 100`).toBe(50000);
      expect(out.totals.payrollCost, `${period} company, E3 (no cost centre) included once`).toBe(TOTAL);
    }
  });

  it("people drilldown lists a mapped employee under the mapped cost centre, process and branch only", async () => {
    const { getPnlDrilldown } = await import("../pnl-drilldown.service.js");
    for (const period of ["2026-05", "2026-06"]) {
      const total = async (scope: Record<string, string>) =>
        (await getPnlDrilldown({ metric: "people", period, ...scope })).total;
      expect(await total({ costCentreId: "cc576" }), `${period} 576`).toBe(100000);
      expect(await total({ costCentreId: "cc577" }), `${period} 577`).toBe(30000);
      expect(await total({ processId: "P577" }), `${period} Back Office`).toBe(30000);
      expect(await total({ processId: "P576" }), `${period} Onfido`).toBe(100000);
      expect(await total({ branchId: "B1" }), `${period} NOIDA`).toBe(150000);
      expect(await total({ branchId: "B2" }), `${period} NOIDA-2`).toBe(50000);
    }
    // Bucketed Statement cell (snapshot): same effective attribution as getRunningPeopleCost.
    const bucketed = await getPnlDrilldown({ metric: "people", period: "2026-06", branchId: "B2", peopleBucket: "agent_salary" });
    expect(bucketed.total, "E1's agent_salary rows are not under NOIDA-2").toBe(30000);
  });
});
