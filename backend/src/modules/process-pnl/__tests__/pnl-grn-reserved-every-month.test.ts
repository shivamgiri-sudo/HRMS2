import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * OWNER RULE (2026-09-24): "Reserved + Consumed should be there in P&L". GRN cost on every P&L
 * surface = GRN Consumed + GRN Committed (reserved), both ex-GST, for EVERY month — and 'draft'
 * allocations (not approved) never count.
 *
 * Real SQL on an in-memory SQLite (node:sqlite; skipped on Node < 22.5), a CLOSED month well
 * outside the estimate window (2026-03), MAS cost centre cc1 on branch B1, process P1:
 *   G4 Smart GRN, allocation A4 'consumed'  ex-GST 100 (+18 GST)
 *   G5 Smart GRN, allocation A5 'reserved'  ex-GST  40 (+7.2 GST)
 *   G6 Smart GRN, allocation A6 'draft'     ex-GST 1000 — must never appear
 * Expected: consumed 100, reserved 40, Statement Total Indirect Cost 140.
 * (Live P&L and CEO Overview sum the same readGrnSpend rows — pinned for a closed month in
 * pnl-reconciliation.test.ts and ceo-overview.test.ts.)
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

const PERIOD = "2026-03";

const SCHEMA = `
CREATE TABLE cost_centre_master (id TEXT PRIMARY KEY, cost_centre_code TEXT, company_name TEXT, branch_id TEXT, process_id TEXT);
CREATE TABLE employees (id TEXT PRIMARY KEY, cost_centre_id TEXT, process_id TEXT, active_status INTEGER);
CREATE TABLE grn_request (id TEXT PRIMARY KEY, grn_number TEXT, branch_id TEXT, cost_centre_id TEXT, process_id TEXT,
  accounting_period TEXT, bill_date TEXT, budget_line_id TEXT, status TEXT, vendor_name TEXT, head TEXT, sub_head TEXT,
  recoverable_tax_pct REAL, amount_without_tax REAL, tax_amount REAL, amount_with_tax REAL, pnl_cost_amount REAL, amount REAL);
CREATE TABLE grn_cost_allocation (id TEXT PRIMARY KEY, grn_request_id TEXT, cost_centre_id TEXT, process_id TEXT,
  lifecycle_status TEXT, recoverable_tax_pct REAL, amount_without_tax REAL, tax_amount REAL, amount_with_tax REAL,
  pnl_cost_amount REAL);

INSERT INTO cost_centre_master VALUES ('cc1','BSS/IB/NOIDA/100','Mas Callnet India Pvt Ltd','B1',NULL);
INSERT INTO employees VALUES ('E1','cc1','P1',1);
INSERT INTO grn_request VALUES
  ('G4','GRN-4','B1','cc1',NULL,'${PERIOD}','2026-03-10','L1','finance_head_approved','V','Admin','Rent', 100, 100,  18,  118,  100,  118),
  ('G5','GRN-5','B1','cc1',NULL,'${PERIOD}','2026-03-12','L1','branch_head_approved', 'V','Admin','Rent', 100,  40, 7.2, 47.2,   40, 47.2),
  ('G6','GRN-6','B1','cc1',NULL,'${PERIOD}','2026-03-14','L1','draft',                'V','Admin','Rent', 100,1000, 180, 1180, 1000, 1180);
INSERT INTO grn_cost_allocation VALUES
  ('A4','G4','cc1',NULL,'consumed', 100, 100,  18,  118,  100),
  ('A5','G5','cc1',NULL,'reserved', 100,  40, 7.2, 47.2,   40),
  ('A6','G6','cc1',NULL,'draft',    100,1000, 180, 1180, 1000);
`;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

const total = (rows: { amount: number }[]) => rows.reduce((t, r) => t + r.amount, 0);
const empty = () => ({ byBranch: new Map(), byProcess: new Map(), byCostCentre: new Map() });

describe.skipIf(!sqlite)("GRN Consumed + Committed (reserved) for a closed month, draft excluded", () => {
  it("the shared reader returns consumed 100 and reserved 40, ex-GST, and never the draft 1000", async () => {
    const { readGrnSpend } = await import("../pnl-actuals.service.js");
    expect(total(await readGrnSpend(PERIOD, "consumed"))).toBe(100);
    expect(total(await readGrnSpend(PERIOD, "reserved"))).toBe(40);
  });

  it("the Statement readers split the same rows: consumed 100, committed 40, per branch and process", async () => {
    const { getIndirectCostActuals, getCommittedIndirectCostActuals } = await import("../pnl-actuals.service.js");
    const consumed = await getIndirectCostActuals(PERIOD);
    const committed = await getCommittedIndirectCostActuals(PERIOD);
    expect(consumed.byBranch.get("B1")).toBe(100);
    expect(committed.byBranch.get("B1")).toBe(40);
    expect(committed.byProcess.get("P1")).toBe(40);
  });

  it("the Statement's Total Indirect Cost is 140 and Operating Profit = Revenue − Total Cost", async () => {
    const { getIndirectCostActuals, getCommittedIndirectCostActuals } = await import("../pnl-actuals.service.js");
    const { getStatement } = await import("../pnl-statement.service.js");
    const component = (key: string, field: string, order: number) => ({
      component_key: key, display_name: key, section_key: "cost", parent_component_key: null,
      display_order: order, component_type: "SOURCE_ACTUAL", source_field: field, format_type: "CURRENCY",
      sign_convention: "+", is_subtotal: 0, active_status: 1,
    });
    const statement = await getStatement({ period: PERIOD } as never, "branch", {
      getComponents: async () => [
        component("total_idc", "indirectCostTotal", 250),
        component("total_cost", "totalCost", 260),
        component("operating_profit", "operatingProfit", 270),
      ],
      getSummary: async () => ({
        rows: [{ processId: "P1", processName: "P1", branchId: "B1", branchName: "NOIDA", recognizedRevenue: 0, agentSalary: 0 }],
        generatedAt: new Date().toISOString(),
      }),
      getProcessSummary: async () => ({ rows: [] }),
      getIndirectCost: getIndirectCostActuals,
      getCommittedIndirectCost: getCommittedIndirectCostActuals,
      getDriverRevenue: async () => empty(),
      getInvoicedRevenue: async () => ({ ...empty(), byBranch: new Map([["B1", 1000]]) }),
      getSeatRevenue: async () => ({ ...empty(), rateMissingByKey: empty() }),
      getPeopleCost: async () => ({
        byBranch: new Map(), byProcess: new Map(), coverageByBranch: new Map(), coverageByProcess: new Map(), asOfDate: null,
      }),
      getManualAdjustments: async () => new Map(),
      getRevenueEstimate: async () => empty(),
    } as never);
    const value = (key: string) => statement.rows.find((r) => r.componentKey === key)?.values.B1;
    expect(value("total_idc")).toBe(140);
    expect(value("grn_consumed")).toBe(100);
    expect(value("grn_committed")).toBe(40);
    expect(value("operating_profit")).toBe(1000 - (value("total_cost") as number));
    expect(value("total_cost")).toBe(140);
  });
});
