import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * OWNER RULE (2026-09-23), end to end: budget comes from HRMS (finance_budget_header/line) for any
 * branch + month with an ACTIVE HRMS budget, and from the db_bill mirror only otherwise — and the
 * budget cell on Live P&L, CEO Overview and the drawer it opens all read the same rows.
 *
 * Runs the real SQL on an in-memory SQLite (node:sqlite; skipped on Node < 22.5).
 * Fixture, period 2026-08:
 *   NOIDA   (B1): ACTIVE HRMS budget — line 40,000 on cc100, a branch line 10,000 allocated
 *                 6,000 cc100 / 4,000 cc576; a superseded ('closed') HRMS budget of 99,999 and a
 *                 mirror budget of 77,777 (+ top-up 8,888) that must BOTH be ignored.
 *   NOIDA-2 (B2): HRMS budget only in 'draft' -> mirror used: 25,000 on cc577 + top-up 3,000.
 */

type Sqlite = { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): unknown[] } };
let sqlite: Sqlite | null = null;
try {
  const mod = await import("node:sqlite" as string);
  sqlite = new mod.DatabaseSync(":memory:") as Sqlite;
} catch {
  sqlite = null;
}

const BUDGET_SQL = /finance_budget/;

function run(sql: string, params: unknown[] = []): unknown[] {
  const db = sqlite!;
  if (/information_schema\.tables/i.test(sql)) {
    return db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`).all(String(params[0]));
  }
  if (/information_schema\.columns/i.test(sql)) {
    const table = String(params[0]).replace(/[^a-z0-9_]/gi, "");
    return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => ({ column_name: c.name }));
  }
  const text = sql.replace(/COLLATE\s+utf8mb4_unicode_ci/gi, "");
  try {
    return db.prepare(text).all(...params.map((p) => (p === undefined ? null : p)));
  } catch (error) {
    if (BUDGET_SQL.test(sql)) throw error;   // a budget read must never silently read as zero
    return [];
  }
}

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../../../shared/istDate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/istDate.js")>()),
  getCurrentDateIST: () => "2026-12-15",
}));

const SCHEMA = `
CREATE TABLE branch_master (id TEXT PRIMARY KEY, branch_name TEXT, active_status INT);
CREATE TABLE process_master (id TEXT PRIMARY KEY, process_name TEXT, active_status INT, branch_id TEXT);
CREATE TABLE cost_centre_master (id TEXT PRIMARY KEY, cost_centre_code TEXT, cost_centre_name TEXT, company_name TEXT,
  branch_id TEXT, process_id TEXT, active_status INT, process_name_bill TEXT, billing_client_name TEXT);
CREATE TABLE employees (id TEXT PRIMARY KEY, process_id TEXT, cost_centre_id TEXT, branch_id TEXT);
CREATE TABLE finance_budget_header (id TEXT PRIMARY KEY, branch_id TEXT, period_code TEXT, status TEXT, pnl_budget_amount REAL);
CREATE TABLE finance_budget_line (id TEXT PRIMARY KEY, budget_id TEXT, cost_centre_id TEXT, head TEXT, sub_head TEXT,
  item_name TEXT, pnl_cost_amount REAL, base_amount REAL, gross_amount REAL, tax_amount REAL);
CREATE TABLE finance_budget_line_allocation (id TEXT PRIMARY KEY, budget_line_id TEXT, cost_centre_id TEXT, pnl_cost_amount REAL,
  base_amount REAL, gross_amount REAL, tax_amount REAL);
CREATE TABLE finance_budget_snapshot (bill_source_id INT, branch_name TEXT, period_code TEXT, active_status INT,
  is_rejected INT, reopen_additional_amount REAL);
CREATE TABLE finance_budget_line_snapshot (bill_source_id INT, budget_source_id INT, period_code TEXT, expense_type TEXT,
  expense_type_name TEXT, amount REAL);

INSERT INTO branch_master VALUES ('B1','NOIDA',1), ('B2','NOIDA-2',1);
INSERT INTO process_master VALUES ('P100','Inbound',1,'B1'), ('P576','Onfido',1,'B1'), ('P577','Back Office',1,'B2');
INSERT INTO cost_centre_master VALUES
  ('cc100','BSS/IB/NOIDA/100','Inbound','Mas Callnet India Pvt Ltd','B1','P100',1,NULL,NULL),
  ('cc576','BSS/BO/NOIDA/576','Onfido','Mas Callnet India Pvt Ltd','B1','P576',1,NULL,NULL),
  ('cc577','BSS/BO/NOIDA-2/577','Back office','Mas Callnet India Pvt Ltd','B2','P577',1,NULL,NULL);
INSERT INTO employees VALUES ('E1','P100','cc100','B1'), ('E2','P577','cc577','B2');
INSERT INTO finance_budget_header VALUES
  ('H1','B1','2026-08','active',50000), ('H0','B1','2026-08','closed',99999), ('H2','B2','2026-08','draft',12345);
-- Tax-free lines (base = pnl_cost = gross), so the fixture's totals are the same on the ex-GST basis
-- the budget source reads since the 2026-09-24 owner rule. budget-ex-gst-basis.test.ts covers GST.
INSERT INTO finance_budget_line VALUES
  ('L1','H1','cc100','Admin','Rent','Floor',40000,40000,40000,0), ('L2','H1',NULL,'Utilities',NULL,'Power',10000,10000,10000,0),
  ('L0','H0','cc100','Admin','Rent','Old',99999,99999,99999,0), ('L9','H2','cc577','Admin','Rent','Draft',12345,12345,12345,0);
INSERT INTO finance_budget_line_allocation VALUES
  ('A1','L2','cc100',6000,6000,6000,0), ('A2','L2','cc576',4000,4000,4000,0);
INSERT INTO finance_budget_snapshot VALUES (10,'Noida','2026-08',1,0,8888), (20,'NOIDA-2','2026-08',1,0,3000);
INSERT INTO finance_budget_line_snapshot VALUES
  (1,10,'2026-08','CostCenter','BSS/IB/NOIDA/100',77777), (2,20,'2026-08','CostCenter','BSS/BO/NOIDA-2/577',25000),
  (3,20,'2026-08','Particular','BSS/BO/NOIDA-2/577',25000);
`;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("one budget source for every surface (owner rule 2026-09-23)", () => {
  it("Live P&L, CEO Overview and the budget drawer agree, per branch and per cost centre", async () => {
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const { getYtdSummary } = await import("../ceo-overview.service.js");
    const { getPnlDrilldown } = await import("../pnl-drilldown.service.js");
    const period = "2026-08";

    const live = await getPnlReconciliation(period, { asOfDate: "2026-12-15" });
    const row = (cc: string) => live.rows.find((r) => r.costCentreId === cc)!;
    expect(row("cc100").allocatedBudget, "HRMS line + its allocation share; no mirror, no closed budget").toBe(46000);
    expect(row("cc576").allocatedBudget).toBe(4000);
    expect(row("cc577").allocatedBudget, "NOIDA-2 has only a draft HRMS budget -> mirror").toBe(25000);
    expect(row("cc100").branchBudget).toBe(50000);
    expect(row("cc577").branchBudget, "mirror lines + mirror top-up").toBe(28000);

    const drawer = async (scope: Record<string, string>) =>
      (await getPnlDrilldown({ metric: "budget", period, ...scope })).total;
    expect(await drawer({ branchId: "B1" }), "drawer = Live NOIDA branch cell").toBe(row("cc100").branchBudget);
    expect(await drawer({ branchId: "B2" }), "drawer = Live NOIDA-2 branch cell").toBe(row("cc577").branchBudget);
    expect(await drawer({ costCentreId: "cc100" }), "drawer = Live cc100 cell").toBe(46000);
    // Budget 20 funds only cc577, so its top-up is wholly cc577's (focus/YTD rule).
    expect(await drawer({ costCentreId: "cc577" })).toBe(28000);

    // CEO Overview's branch table lists only branches that traded (this fixture has no money), so
    // its budget reader is checked through the YTD strip, which uses the same budgetByBranch /
    // budgetForCodes.
    const ytd = await getYtdSummary(period);
    expect(ytd.monthly.find((m) => m.period === period)?.budget, "company budget = 50,000 + 28,000").toBe(78000);
    const ytdNoida = await getYtdSummary(period, { branchId: "B1" });
    expect(ytdNoida.monthly.find((m) => m.period === period)?.budget).toBe(50000);
    const ytdCc = await getYtdSummary(period, { costCentreId: "cc100" });
    expect(ytdCc.monthly.find((m) => m.period === period)?.budget).toBe(46000);
  });
});
