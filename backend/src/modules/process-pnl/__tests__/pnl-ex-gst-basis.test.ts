import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * OWNER RULE (2026-09-24): on the Process P&L, "Revenue and GRN — all components — must be NON-GST
 * amounts". Proves, against real SQL on an in-memory SQLite (node:sqlite; skipped on Node < 22.5),
 * that a GRN whose GST is 0% recoverable (so pnl_cost_amount = base + the whole tax) is reported at
 * its amount_without_tax by:
 *   1. the shared GRN reader (readGrnSpend) — feeds Statement, Live, CEO, drilldown;
 *   2. the daily-trend GRN query (getDailyTrend);
 *   3. the budget source (readBudgetEntries) — budget moved to base_amount in the same change;
 * and that a legacy row whose ex-GST column is still the 0 default is not turned into a zero.
 *
 * Fixture, period 2026-08, cost centre cc1 (a MAS Callnet cost centre), bill date 2026-08-10:
 *   G1 ordinary GRN     base 10,000 + GST 1,800 (0% recoverable) -> pnl_cost 11,800, ex-GST 10,000
 *   G2 Smart GRN, A1    base  5,000 + GST   900 (0% recoverable) -> pnl_cost  5,900, ex-GST  5,000
 *   G3 legacy GRN       ex-GST/tax/gross columns at their 0 default, amount 2,000     -> 2,000
 *   Budget H1 (active): L1 base 10,000 + 1,800 non-recoverable; L2 branch-level allocated to cc1
 *                       base 3,000 + 540; L3 legacy (no split recorded), pnl_cost 700.
 */

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[] };
  function(name: string, fn: (...args: unknown[]) => unknown): void;
};
let sqlite: Sqlite | null = null;
try {
  const mod = await import("node:sqlite" as string);
  sqlite = new mod.DatabaseSync(":memory:") as Sqlite;
} catch {
  sqlite = null;
}

function run(sql: string, params: unknown[] = []): unknown[] {
  const db = sqlite!;
  if (/information_schema\.tables/i.test(sql)) {
    return db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`).all(String(params[0]));
  }
  const text = sql.replace(/COLLATE\s+utf8mb4_unicode_ci/gi, "");
  return db.prepare(text).all(...params.map((p) => (p === undefined ? null : p)));
}

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../pnl-seat-revenue-forecast.service.js", () => ({
  getSeatRevenueForecast: vi.fn(async () => ({ projectedMonthEnd: 0 })),
}));

const SCHEMA = `
CREATE TABLE cost_centre_master (id TEXT PRIMARY KEY, cost_centre_code TEXT, company_name TEXT, branch_id TEXT, process_id TEXT);
CREATE TABLE grn_request (id TEXT PRIMARY KEY, grn_number TEXT, branch_id TEXT, cost_centre_id TEXT, process_id TEXT,
  accounting_period TEXT, bill_date TEXT, budget_line_id TEXT, status TEXT, vendor_name TEXT, head TEXT, sub_head TEXT,
  recoverable_tax_pct REAL, amount_without_tax REAL, tax_amount REAL, amount_with_tax REAL, pnl_cost_amount REAL, amount REAL);
CREATE TABLE grn_cost_allocation (id TEXT PRIMARY KEY, grn_request_id TEXT, cost_centre_id TEXT, process_id TEXT,
  lifecycle_status TEXT, recoverable_tax_pct REAL, amount_without_tax REAL, tax_amount REAL, amount_with_tax REAL,
  pnl_cost_amount REAL);
CREATE TABLE vendor_payment_tracking (id TEXT PRIMARY KEY, due_amount REAL, amount_without_tax REAL, tax_amount REAL,
  amount_with_tax REAL);
CREATE TABLE branch_master (id TEXT PRIMARY KEY, branch_name TEXT);
CREATE TABLE finance_budget_header (id TEXT PRIMARY KEY, branch_id TEXT, period_code TEXT, status TEXT);
CREATE TABLE finance_budget_line (id TEXT PRIMARY KEY, budget_id TEXT, cost_centre_id TEXT, head TEXT, sub_head TEXT,
  item_name TEXT, base_amount REAL, tax_amount REAL, gross_amount REAL, pnl_cost_amount REAL);
CREATE TABLE finance_budget_line_allocation (id TEXT PRIMARY KEY, budget_line_id TEXT, cost_centre_id TEXT,
  base_amount REAL, tax_amount REAL, gross_amount REAL, pnl_cost_amount REAL);

INSERT INTO cost_centre_master VALUES ('cc1','BSS/IB/NOIDA/100','Mas Callnet India Pvt Ltd','B1',NULL);
INSERT INTO branch_master VALUES ('B1','NOIDA');
INSERT INTO grn_request VALUES
  ('G1','GRN-1','B1','cc1',NULL,'2026-08','2026-08-10','L1','finance_head_approved','V','Admin','Rent', 0,10000,1800,11800,11800,11800),
  ('G2','GRN-2','B1','cc1',NULL,'2026-08','2026-08-10','L1','finance_head_approved','V','Admin','Rent', 0, 5000, 900, 5900, 5900, 5900),
  ('G3','GRN-3','B1','cc1',NULL,'2026-08','2026-08-10','L1','finance_head_approved','V','Admin','Rent', 100,   0,   0,    0, 2000, 2000);
INSERT INTO grn_cost_allocation VALUES ('A1','G2','cc1',NULL,'consumed', 0, 5000, 900, 5900, 5900);
INSERT INTO vendor_payment_tracking VALUES ('V1', 11800, 10000, 1800, 11800), ('V0', 3000, 0, 0, 0);
INSERT INTO finance_budget_header VALUES ('H1','B1','2026-08','active');
INSERT INTO finance_budget_line VALUES
  ('L1','H1','cc1','Admin','Rent','Floor', 10000, 1800, 11800, 11800),
  ('L2','H1',NULL,'Utilities',NULL,'Power', 3000, 540, 3540, 3540),
  ('L3','H1','cc1','Admin','Misc','Legacy', 0, 0, 0, 700);
INSERT INTO finance_budget_line_allocation VALUES ('BA1','L2','cc1', 3000, 540, 3540, 3540);
`;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  // MySQL's DATE_FORMAT, for the two formats these readers use.
  sqlite.function("DATE_FORMAT", (value: unknown, format: unknown) => {
    const s = String(value ?? "");
    if (format === "%Y-%m-%d") return s.slice(0, 10);
    if (format === "%Y-%m") return s.slice(0, 7);
    throw new Error(`DATE_FORMAT format not modelled: ${String(format)}`);
  });
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("P&L GRN and budget are EX-GST (owner rule 2026-09-24)", () => {
  it("the shared GRN reader books amount_without_tax, not pnl_cost_amount, when GST is 0% recoverable", async () => {
    const { readGrnSpend } = await import("../pnl-actuals.service.js");
    const rows = await readGrnSpend("2026-08", "consumed");
    const total = rows.reduce((t, r) => t + r.amount, 0);
    // 10,000 (G1) + 5,000 (G2's allocation) + 2,000 (legacy G3) — never 11,800 / 5,900.
    expect(total).toBe(17000);
  });

  it("the daily trend's GRN bars are ex-GST", async () => {
    const { getDailyTrend } = await import("../pnl-daily-trend.service.js");
    const trend = await getDailyTrend("2026-08");
    const day = trend.points.find((p) => p.date === "2026-08-10");
    expect(day?.grnCost).toBe(17000);
  });

  it("the budget source reads base_amount, so budget and GRN share one basis", async () => {
    const { readBudgetEntries, sumAmount } = await import("../pnl-budget-source.js");
    const entries = await readBudgetEntries("2026-08");
    // L1 10,000 + L2's allocation 3,000 + legacy L3 falling back to its pnl_cost 700.
    expect(sumAmount(entries)).toBe(13700);
    expect(entries.find((e) => e.entryRef === "hrms-L1")?.amount).toBe(10000);
  });

  it("vendor payables are ex-GST, and a legacy payable with no split keeps its due amount", async () => {
    const { vendorPayableExGstSql } = await import("../pnl-ex-gst.js");
    const rows = run(`SELECT vpt.id AS id, ${vendorPayableExGstSql("vpt")} AS v FROM vendor_payment_tracking vpt ORDER BY vpt.id`) as Array<{ id: string; v: number }>;
    expect(rows).toEqual([{ id: "V0", v: 3000 }, { id: "V1", v: 10000 }]);
  });
});
