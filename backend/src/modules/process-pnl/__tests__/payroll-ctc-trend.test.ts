import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * OWNER RULE (2026-09-24): "People cost is the CTC amount paid for that month" — per
 * salary_prep_line gross_salary + pf_employer + esic_employer + gratuity, over EVERY salary_prep_run
 * of the month (drafts included), which is what the Live P&L tile (readPayroll) sums.
 *
 * The P&L trend used to sum gross_salary alone and to skip draft runs, so its bar for a month sat
 * below the tile for the same month. These tests run the readers' REAL SQL against an in-memory
 * SQLite database (node:sqlite), like payroll-single-cost-centre.test.ts.
 *
 * Fixture, 2026-05:
 *   E1 (process P1, branch B1) in FINALIZED run R1: gross 90,000 + PF 6,000 + ESIC 1,000 + gratuity 3,000 = 1,00,000
 *   E2 (process P1, branch B1) in DRAFT run R2:     gross 40,000 + PF 0 + ESIC 2,000 + gratuity 0      =   42,000
 *   CTC total 1,42,000 (gross-only-and-no-drafts would have been 90,000).
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
  process_id TEXT, cost_centre_id TEXT, active_status INT);
CREATE TABLE salary_prep_run (id TEXT PRIMARY KEY, run_month TEXT, status TEXT, created_at TEXT);
CREATE TABLE salary_prep_line (id TEXT PRIMARY KEY, run_id TEXT, employee_id TEXT, gross_salary REAL,
  pf_employer REAL, esic_employer REAL, gratuity REAL);
CREATE TABLE pnl_employee_cost_centre_override (id TEXT PRIMARY KEY, employee_id TEXT UNIQUE,
  target_cost_centre_id TEXT, active_status INT);

INSERT INTO branch_master VALUES ('B1','NOIDA',1);
INSERT INTO process_master VALUES ('P1','Onfido',1,'B1');
INSERT INTO cost_centre_master VALUES ('cc1','BSS/BO/NOIDA/576','Onfido','Mas Callnet India Pvt Ltd','B1','P1',1,NULL,NULL);
INSERT INTO employees VALUES ('E1','E1','One','B1','P1','cc1',1), ('E2','E2','Two','B1','P1','cc1',1);
INSERT INTO salary_prep_run VALUES ('R1','2026-05','FINALIZED','2026-06-02'), ('R2','2026-05','draft','2026-06-03');
INSERT INTO salary_prep_line VALUES
  ('L1','R1','E1',90000,6000,1000,3000),
  ('L2','R2','E2',40000,0,2000,NULL);
`;

const CTC_TOTAL = 142000;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("P&L trend people cost = CTC over every run of the month (owner rule 2026-09-24)", () => {
  it("trend sums gross + PF employer + ESIC employer + gratuity, drafts included", async () => {
    const { getPnlTrend } = await import("../pnl-trend.service.js");
    const out = await getPnlTrend();
    const may = out.company.find((m) => m.period === "2026-05");
    expect(may?.cost, "CTC, not gross alone, and the draft run counts").toBe(CTC_TOTAL);
    expect(may?.headcount).toBe(2);
    const p1 = out.processes.find((p) => p.processId === "P1")?.months.find((m) => m.period === "2026-05");
    expect(p1?.cost).toBe(CTC_TOTAL);
  });

  it("branch-filtered trend uses the same CTC sum", async () => {
    const { getPnlTrend } = await import("../pnl-trend.service.js");
    const out = await getPnlTrend({ branchId: "B1" });
    expect(out.company.find((m) => m.period === "2026-05")?.cost).toBe(CTC_TOTAL);
  });

  it("trend equals the Live P&L tile for the same month", async () => {
    const { getPnlTrend } = await import("../pnl-trend.service.js");
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const tile = (await getPnlReconciliation("2026-05", { asOfDate: "2026-09-15" })).totals.payrollCost;
    const trend = (await getPnlTrend()).company.find((m) => m.period === "2026-05")?.cost;
    expect(tile).toBe(CTC_TOTAL);
    expect(trend).toBe(tile);
  });

  it("cost-centre activity salary is CTC too (gratuity included, NULL-safe)", async () => {
    const { getCostCentreActivity } = await import("../cost-centre-activity.service.js");
    const rows = await getCostCentreActivity("2026-05");
    const cc1 = rows.find((r) => r.costCentreId === "cc1");
    expect(cc1?.salaryCost).toBe(CTC_TOTAL);
    expect(cc1?.peoplePaid).toBe(2);
  });
});
