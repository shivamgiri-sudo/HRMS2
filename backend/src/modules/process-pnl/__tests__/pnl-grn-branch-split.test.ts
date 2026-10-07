import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Head Office GRN split across branches (2026-10-07): the P&L must charge each branch for its share
 * and Head Office for none of it. One HO-raised GRN (header branch = HO, vendor payable stays HO)
 * with allocation rows that sit on two branches' Back Office cost centres. Real SQL on in-memory
 * SQLite (skipped on Node < 22.5).
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
    return db
      .prepare(
        `SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .all(String(params[0]));
  }
  const text = sql.replace(/COLLATE\s+utf8mb4_unicode_ci/gi, "");
  return db
    .prepare(text)
    .all(...params.map((p) => (p === undefined ? null : p)));
}

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));

const PERIOD = "2026-08";

const SCHEMA = `
CREATE TABLE cost_centre_master (id TEXT PRIMARY KEY, cost_centre_code TEXT, company_name TEXT, branch_id TEXT, process_id TEXT);
CREATE TABLE employees (id TEXT PRIMARY KEY, cost_centre_id TEXT, process_id TEXT, active_status INTEGER);
CREATE TABLE grn_request (id TEXT PRIMARY KEY, grn_number TEXT, branch_id TEXT, cost_centre_id TEXT, process_id TEXT,
  accounting_period TEXT, bill_date TEXT, budget_line_id TEXT, status TEXT, vendor_name TEXT, head TEXT, sub_head TEXT,
  recoverable_tax_pct REAL, amount_without_tax REAL, tax_amount REAL, amount_with_tax REAL, pnl_cost_amount REAL, amount REAL,
  bill_source_id TEXT, created_by TEXT);
CREATE TABLE grn_cost_allocation (id TEXT PRIMARY KEY, grn_request_id TEXT, branch_id TEXT, cost_centre_id TEXT, process_id TEXT,
  lifecycle_status TEXT, recoverable_tax_pct REAL, amount_without_tax REAL, tax_amount REAL, amount_with_tax REAL, pnl_cost_amount REAL);
INSERT INTO cost_centre_master VALUES
  ('cc-HO','HO/1','Mas Callnet India Pvt Ltd','ho',NULL),
  ('cc-A-BO','BSS/BO/A/577','Mas Callnet India Pvt Ltd','br-A',NULL),
  ('cc-B-BO','BSS/BO/B/301','Mas Callnet India Pvt Ltd','br-B',NULL);
-- The GRN is raised at Head Office (header branch ho): Rs 1,000 + 18% GST, split 60/40 to A and B.
INSERT INTO grn_request VALUES ('G1','GRN-1','ho',NULL,NULL,'${PERIOD}','2026-08-10','L-A','finance_head_approved','V','Admin','Rent',100,1000,180,1180,1000,1180,NULL,'user-1');
INSERT INTO grn_cost_allocation VALUES
  ('A1','G1','br-A','cc-A-BO',NULL,'consumed',100,600,108,708,600),
  ('A2','G1','br-B','cc-B-BO',NULL,'consumed',100,400,72,472,400);
`;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

describe.skipIf(!sqlite)("Head Office GRN split across branches in the P&L cost reader", () => {
  it("charges each branch its ex-GST share on its Back Office cost centre, and Head Office nothing", async () => {
    const { readGrnSpend } = await import("../pnl-actuals.service.js");
    const rows = (await readGrnSpend(PERIOD, "consumed")) as Array<{ branchId: string; costCentreId: string; amount: number }>;
    const by = (branch: string) => rows.filter((r) => r.branchId === branch).reduce((t, r) => t + r.amount, 0);
    expect(by("br-A")).toBe(600);
    expect(by("br-B")).toBe(400);
    expect(by("ho")).toBe(0);
    expect(rows.find((r) => r.branchId === "br-A")?.costCentreId).toBe("cc-A-BO");
    expect(rows.find((r) => r.branchId === "br-B")?.costCentreId).toBe("cc-B-BO");
    // Company total unchanged: the whole bill is charged once, ex-GST.
    expect(rows.reduce((t, r) => t + r.amount, 0)).toBe(1000);
  });

  it("the Statement's indirect-cost reader agrees per branch", async () => {
    const { getIndirectCostActuals } = await import("../pnl-actuals.service.js");
    const out = await getIndirectCostActuals(PERIOD);
    expect(out.byBranch.get("br-A")).toBe(600);
    expect(out.byBranch.get("br-B")).toBe(400);
    expect(out.byBranch.get("ho") ?? 0).toBe(0);
  });
});
