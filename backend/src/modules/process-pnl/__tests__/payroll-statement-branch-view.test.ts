import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ComponentDefinition, StatementDependencies } from "../pnl-statement.service.js";

/**
 * Statement BRANCH view payroll attribution (audit item 4, owner rule 2026-09-23): a person's pay
 * counts in the branch of their EFFECTIVE cost centre (the payroll cost centre they are mapped to in
 * pnl_employee_cost_centre_override, else their HR one), the home branch only when they have no cost
 * centre — exactly as Live P&L (pnl-reconciliation readPayroll / readUnallocatedPayroll) does.
 *
 * Runs the Statement's real people-cost resolver (getStatementPeopleCost: actual payroll, else the
 * running-salary snapshot) and the real getStatement branch aggregation over the same in-memory
 * SQLite fixture as payroll-single-cost-centre.test.ts:
 *   E1 HR B2/577, MAPPED to 576 (B1)      1,00,000   -> B1 only
 *   E2 HR B1/100                             50,000   -> B1
 *   E3 HR B2, no cost centre                 20,000   -> B2 (home branch)
 *   E4 HR B2/577, mapping DEACTIVATED        30,000   -> B2
 * 2026-05 = posted payroll path, 2026-06 = running-salary snapshot path.
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
  advance_recovery REAL DEFAULT 0, lwp_deduction REAL DEFAULT 0);
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
-- Rule scoped to HR branch NOIDA-2: classification follows who the person is (home branch).
INSERT INTO pnl_cost_classification_rule VALUES ('department','OPERATIONS',NULL,'B2','dsc_people',1,1,'2000-01-01',NULL,'2000-01-01');
`;

const TOTAL = 200000;

function component(key: string, field: string, order: number): ComponentDefinition {
  return {
    component_key: key, display_name: key, section_key: "cost", parent_component_key: null,
    display_order: order, component_type: "SOURCE_ACTUAL", source_field: field, format_type: "CURRENCY",
    sign_convention: "-", is_subtotal: 0,
  } as ComponentDefinition;
}

const COMPONENTS = [
  component("agent_salary", "agentSalary", 1),
  component("dsc_salary", "dscSalary", 2),
  component("bmc_salary", "bmcSalary", 3),
  component("direct_cost_total", "directCostTotal", 4),
];

/** Upstream process rows carry NO people cost, so every rupee on the Statement comes from payroll. */
function processRow(processId: string, branchId: string, branchName: string) {
  return {
    processId, processName: processId, branchId, branchName, processStatus: "profitable",
    recognizedRevenue: 0, agentSalary: 0, dscPeople: 0, bmcPeople: 0,
  } as never;
}

const ROWS = [processRow("P576", "B1", "NOIDA"), processRow("P100", "B1", "NOIDA"), processRow("P577", "B2", "NOIDA-2")];

const emptyActuals = async () => ({ byBranch: new Map(), byProcess: new Map(), byCostCentre: new Map() });

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("Statement branch view: pay lands in the effective branch, once (audit item 4)", () => {
  it("people-cost resolver: byBranch follows the effective cost centre on both paths", async () => {
    const { getStatementPeopleCost } = await import("../pnl-statement.service.js");
    for (const period of ["2026-05", "2026-06"]) {
      const out = await getStatementPeopleCost(period);
      const sum = (b?: Record<string, number>) => (b ? Object.values(b).reduce((t, v) => t + v, 0) : 0);
      expect(sum(out.byBranch.get("B1")), `${period} NOIDA = E1 (mapped) + E2`).toBe(150000);
      expect(sum(out.byBranch.get("B2")), `${period} NOIDA-2 = E3 + E4, never E1`).toBe(50000);
      expect([...out.byBranch.values()].reduce((t, b) => t + sum(b), 0), `${period} each rupee once`).toBe(TOTAL);
    }
  });

  it("getStatement(viewBy=branch) columns equal Live P&L branch payroll", async () => {
    const { getStatement, getStatementPeopleCost } = await import("../pnl-statement.service.js");
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const deps: StatementDependencies = {
      getComponents: async () => COMPONENTS,
      getSummary: async () => ({ rows: ROWS, generatedAt: "2026-09-15T00:00:00.000Z", calculationEngine: "bpo_allocation_v2" }),
      getProcessSummary: async () => ({ rows: [] }),
      getIndirectCost: emptyActuals,
      getDriverRevenue: emptyActuals,
      getInvoicedRevenue: emptyActuals,
      getSeatRevenue: async () => ({ ...(await emptyActuals()), rateMissingByKey: await emptyActuals(), billableEmployees: 0, rateMissingEmployees: 0, unresolvedEmployees: 0 }) as never,
      getPeopleCost: getStatementPeopleCost,
      getManualAdjustments: async () => new Map(),
      getRevenueEstimate: emptyActuals,
    };
    for (const period of ["2026-05", "2026-06"]) {
      const statement = await getStatement({ period }, "branch", deps);
      const direct = statement.rows.find((r) => r.componentKey === "direct_cost_total")!.values;
      expect(direct.B1, `${period} Statement NOIDA`).toBe(150000);
      expect(direct.B2, `${period} Statement NOIDA-2`).toBe(50000);

      const live = await getPnlReconciliation(period, { asOfDate: "2026-09-15" });
      const livePay = (id: string) => live.branches.find((b) => b.branchId === id)?.payrollCost ?? 0;
      expect(direct.B1, `${period} Statement NOIDA == Live P&L NOIDA`).toBe(livePay("B1"));
      expect(direct.B2, `${period} Statement NOIDA-2 == Live P&L NOIDA-2`).toBe(livePay("B2"));
    }
  });
});
