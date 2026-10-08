import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Live P&L under the forecast accounting rule (owner 2026-10-06), real SQL on in-memory SQLite,
 * same payroll fixture as payroll-single-cost-centre.test.ts, period 2026-05:
 *  - revenue: an approved (OPEN) forecast counts its forecast amount, a CLOSED one its closed
 *    amount; a merely submitted forecast counts nothing.
 *  - cost: an OPEN budget line counts at full budget (actual GRN + unspent headroom); a line closed
 *    by head/sub-head or by cost centre counts actual only; pooled lines follow their allocation.
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

const PAYROLL_SQL = /salary_prep_line|pnl_running_salary_snapshot|pnl_employee_cost_centre_override|revenue_forecast|finance_budget_line|finance_budget_subhead_closure|finance_budget_cost_centre_closure/;

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
CREATE TABLE revenue_forecast (id TEXT PRIMARY KEY, branch_id TEXT, cost_centre_id TEXT, period_code TEXT, status TEXT, forecast_amount REAL, closed_amount REAL);
-- cc576 OPEN at 3,00,000; cc100 CLOSED at 80,000 (forecast 90,000); cc577 only submitted (counts nothing).
INSERT INTO revenue_forecast VALUES ('f1','B1','cc576','2026-05','approved',300000,NULL),
  ('f2','B1','cc100','2026-05','closed',90000,80000), ('f3','B2','cc577','2026-05','submitted',55555,NULL);
CREATE TABLE finance_budget_header (id TEXT PRIMARY KEY, branch_id TEXT, period_code TEXT, status TEXT);
CREATE TABLE finance_budget_line (id TEXT PRIMARY KEY, budget_id TEXT, cost_centre_id TEXT, head TEXT, sub_head TEXT,
  base_amount REAL, gross_amount REAL, tax_amount REAL, pnl_cost_amount REAL, reserved_amount REAL, consumed_amount REAL, item_name TEXT, process_id TEXT, planning_level TEXT, expenditure_type TEXT);
CREATE TABLE finance_budget_line_allocation (id TEXT PRIMARY KEY, budget_line_id TEXT, cost_centre_id TEXT, base_amount REAL, tax_amount REAL, gross_amount REAL, pnl_cost_amount REAL);
CREATE TABLE finance_budget_subhead_closure (id TEXT PRIMARY KEY, budget_id TEXT, head TEXT, sub_head TEXT, status TEXT);
CREATE TABLE finance_budget_cost_centre_closure (id TEXT PRIMARY KEY, budget_id TEXT, cost_centre_id TEXT, status TEXT);
INSERT INTO finance_budget_header VALUES ('H1','B2','2026-05','active'), ('H2','B1','2026-05','active');
INSERT INTO finance_budget_line (id, budget_id, cost_centre_id, head, sub_head, base_amount, gross_amount, tax_amount, pnl_cost_amount, reserved_amount, consumed_amount) VALUES
  -- open: 10,000 budget, 2,000 reserved + 3,000 consumed -> 5,000 headroom on 577
  ('L1','H1','cc577','Admin','Rent',10000,11800,1800,10000,2000,3000),
  -- head/sub-head closed: adds nothing
  ('L2','H1','cc577','Admin','Power',7000,7000,0,7000,0,1000),
  -- cost centre 576 closed for H2: adds nothing
  ('L3','H2','cc576','IT','Internet',4000,4000,0,4000,0,0),
  -- pooled, allocated 3:1 between 100 and 576 (576 closed -> only 100's 3/4 of 800 = 600)
  ('L4','H2',NULL,'Admin','Security',800,800,0,800,0,0),
  -- pooled, no allocation: branch NOIDA level, 1,000
  ('L5','H2',NULL,'Admin','Pantry',1000,1000,0,1000,0,0);
INSERT INTO finance_budget_line_allocation (id, budget_line_id, cost_centre_id, base_amount) VALUES ('A1','L4','cc100',300), ('A2','L4','cc576',100);
INSERT INTO finance_budget_subhead_closure VALUES ('S1','H1','Admin','Power','closed');
INSERT INTO finance_budget_cost_centre_closure VALUES ('C1','H2','cc576','closed');
-- Rule scoped to HR branch NOIDA-2: classification follows who the person is (home branch).
INSERT INTO pnl_cost_classification_rule VALUES ('department','OPERATIONS',NULL,'B2','dsc_people',1,1,'2000-01-01',NULL,'2000-01-01');
`;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("Live P&L reads forecasts and open budget headroom", () => {
  it("open budget reserve: open lines add headroom, closed lines nothing, pooled by allocation", async () => {
    const { readOpenBudgetReserve } = await import("../pnl-open-budget.js");
    const out = await readOpenBudgetReserve("2026-05");
    expect(Object.fromEntries(out.byCostCentre)).toEqual({ cc577: 5000, cc100: 600 });
    expect(Object.fromEntries(out.unallocatedByBranch)).toEqual({ B1: 1000 });
  });

  it("forecast revenue per row, basis labelled; OP subtracts the open-budget reserve", async () => {
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-05", { asOfDate: "2026-09-15" });
    const row = (cc: string) => out.rows.find((r) => r.costCentreId === cc)!;
    expect([row("cc576").recognisedRevenue, row("cc576").revenueBasis, row("cc576").revenueForecast]).toEqual([300000, "FORECAST_OPEN", 300000]);
    expect([row("cc100").recognisedRevenue, row("cc100").revenueBasis, row("cc100").revenueForecast]).toEqual([80000, "FORECAST_CLOSED", 90000]);
    expect([row("cc577").recognisedRevenue, row("cc577").revenueBasis]).toEqual([0, "NONE"]);
    expect(row("cc577").openBudgetReserve).toBe(5000);
    expect(row("cc577").operatingProfit).toBe(0 - row("cc577").payrollCost - 5000);
    expect(row("cc100").operatingProfit).toBe(80000 - row("cc100").payrollCost - 600);
    expect(out.totals.revenue).toBe(380000);
    expect(out.totals.revenueForecast).toBe(390000);
    expect(out.totals.forecastCostCentres).toBe(2);
    expect(out.totals.openBudgetReserve).toBe(6600);
    const noida = out.branches.find((b) => b.branchId === "B1")!;
    expect(noida.openBudgetReserve).toBe(1600);
    const sumRowsOp = out.rows.reduce((t, r) => t + r.operatingProfit, 0);
    expect(out.totals.operatingProfit).toBeCloseTo(sumRowsOp - out.totals.unallocatedPayroll - 1000, 2);
  });
});
