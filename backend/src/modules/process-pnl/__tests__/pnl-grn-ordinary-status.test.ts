import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Ordinary GRNs (no grn_cost_allocation rows) are read from grn_request.status. Only Finance Head
 * approval moves budget into consumed, and only Branch/Accounts Head approval holds a reservation,
 * so P&L must follow those statuses — not "anything but draft/rejected/cancelled", which booked a
 * merely submitted GRN and a consumption_reversed GRN (budget already released) as consumed cost.
 * Real SQL on in-memory SQLite (skipped on Node < 22.5), closed month 2026-03, MAS cost centre cc1.
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

const PERIOD = "2026-03";

const SCHEMA = `
CREATE TABLE cost_centre_master (id TEXT PRIMARY KEY, cost_centre_code TEXT, company_name TEXT, branch_id TEXT, process_id TEXT);
CREATE TABLE employees (id TEXT PRIMARY KEY, cost_centre_id TEXT, process_id TEXT, active_status INTEGER);
CREATE TABLE grn_request (id TEXT PRIMARY KEY, grn_number TEXT, branch_id TEXT, cost_centre_id TEXT, process_id TEXT,
  accounting_period TEXT, bill_date TEXT, budget_line_id TEXT, status TEXT, vendor_name TEXT, head TEXT, sub_head TEXT,
  recoverable_tax_pct REAL, amount_without_tax REAL, tax_amount REAL, amount_with_tax REAL, pnl_cost_amount REAL, amount REAL,
  bill_source_id TEXT, created_by TEXT);
CREATE TABLE grn_cost_allocation (id TEXT PRIMARY KEY, grn_request_id TEXT, cost_centre_id TEXT, process_id TEXT,
  lifecycle_status TEXT, recoverable_tax_pct REAL, amount_without_tax REAL, tax_amount REAL, amount_with_tax REAL,
  pnl_cost_amount REAL);
INSERT INTO cost_centre_master VALUES ('cc1','BSS/IB/NOIDA/100','Mas Callnet India Pvt Ltd','B1',NULL);
INSERT INTO employees VALUES ('E1','cc1','P1',1);
`;

const row = (id: string, status: string, amount: number) =>
  `('${id}','${id}','B1','cc1',NULL,'${PERIOD}','2026-03-10','L1','${status}','V','Admin','Rent',100,${amount},0,${amount},${amount},${amount},NULL,'user-1')`;

beforeAll(() => {
  if (!sqlite) return;
  sqlite.exec(SCHEMA);
  sqlite.exec(`INSERT INTO grn_request VALUES
    ${row("PAID", "paid", 50)},
    ${row("FHA", "finance_head_approved", 5)},
    ${row("BHA", "branch_head_approved", 30)},
    ${row("AHA", "accounts_head_approved", 3)},
    ${row("SUB", "submitted", 700)},
    ${row("REV", "consumption_reversed", 900)},
    ${row("RET", "returned_to_raiser", 8000)};`);
  execute.mockImplementation(async (sql: string, params?: unknown[]) => [run(String(sql), params ?? []), []]);
});

const total = (rows: { amount: number }[]) => rows.reduce((t, r) => t + r.amount, 0);

describe.skipIf(!sqlite)("ordinary GRN status decides consumed vs reserved", () => {
  it("consumed = Finance-Head-approved onwards only (paid 50 + finance_head_approved 5)", async () => {
    const { readGrnSpend } = await import("../pnl-actuals.service.js");
    expect(total(await readGrnSpend(PERIOD, "consumed"))).toBe(55);
  });
  it("reserved = Branch/Accounts Head approved (30 + 3); submitted, reversed and returned never count", async () => {
    const { readGrnSpend } = await import("../pnl-actuals.service.js");
    expect(total(await readGrnSpend(PERIOD, "reserved"))).toBe(33);
  });
});
