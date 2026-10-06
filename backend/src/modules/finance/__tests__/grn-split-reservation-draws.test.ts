import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Smart GRN allocation whose reservation was spread across several budget lines at Branch Head
 * approval (allocateAcrossLines) must have every later budget movement land on those same lines,
 * in those same amounts. The allocation row names only the largest draw; moving its FULL amount on
 * that one line took other GRNs' reservations and left the other lines reserved for ever.
 *
 * Allocation A1 (100): drew 60 on L1 + 40 on L2 (recorded in grn_allocation_budget_draw).
 * Allocation A2 (30):  never spread — sits wholly on L3.
 */

vi.setConfig({ testTimeout: 20_000 });

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

const budget = vi.hoisted(() => ({
  release: vi.fn(), reserve: vi.fn(), consume: vi.fn(), reverseConsumption: vi.fn(),
}));
vi.mock("../../process-pnl/budget-consumption.service.js", () => ({ budgetConsumptionService: budget }));

const A1 = { id: "A1", grn_request_id: "g1", budget_line_id: "L1", amount_with_tax: 100, amount_without_tax: 100, quantity: 10 };
const A2 = { id: "A2", grn_request_id: "g1", budget_line_id: "L3", amount_with_tax: 30, amount_without_tax: 30, quantity: 3 };
const DRAWS: Record<string, unknown[]> = {
  A1: [
    { budget_line_id: "L1", amount_with_tax: 60, amount_without_tax: 60, quantity: 6 },
    { budget_line_id: "L2", amount_with_tax: 40, amount_without_tax: 40, quantity: 4 },
  ],
};

function makeConnection(grn: Record<string, unknown>, lifecycle: string) {
  const statements: string[] = [];
  return {
    statements,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      statements.push(q);
      if (/FROM grn_request/.test(q) && /^SELECT/.test(q)) return [[grn], []];
      if (/FROM grn_cost_allocation a/.test(q)) return [[{ ...A1, lifecycle_status: lifecycle }, { ...A2, lifecycle_status: lifecycle }], []];
      if (/FROM grn_allocation_budget_draw/.test(q)) return [DRAWS[String(params[0])] ?? [], []];
      if (/^UPDATE/.test(q)) return [{ affectedRows: 1 }, []];
      return [[], []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
}

let grnService: typeof import("../grn.service.js")["grnService"];
let grnSmartService: typeof import("../grn-smart.service.js")["grnSmartService"];
beforeAll(async () => {
  ({ grnService } = await import("../grn.service.js"));
  ({ grnSmartService } = await import("../grn-smart.service.js"));
}, 120_000);

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  for (const fn of Object.values(budget)) fn.mockReset();
  // grnSmartService.hasAllocations() — this is a Smart GRN.
  execute.mockImplementation(async (sql: string) =>
    /COUNT\(\*\) AS total FROM grn_cost_allocation/.test(String(sql)) ? [[{ total: 2 }], []] : [[], []]);
});

const moves = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => [c[1], c[2]]);

describe("split reservation: every movement follows the recorded draws", () => {
  it("returning a split Smart GRN releases each draw and each allocation — not the GRN total on its first line", async () => {
    const grn = { id: "g1", status: "branch_head_approved", budget_line_id: "L1", amount_with_tax: 130, amount: 130, quantity: 13 };
    const conn = makeConnection(grn, "reserved");
    getConnection.mockResolvedValue(conn);
    await grnService.returnGrn("g1", "branch_head", "Wrong vendor", "u1", "finance_head");
    expect(moves(budget.release)).toEqual([["L1", 60], ["L2", 40], ["L3", 30]]);
    expect(conn.statements.some((s) => /UPDATE grn_cost_allocation SET lifecycle_status = 'released'/.test(s)),
      "allocation rows leave 'reserved', or utilisation keeps counting them").toBe(true);
  });

  it("reversing consumption reverses each draw on its own line", async () => {
    const conn = makeConnection({ id: "g1", status: "paid" }, "consumed");
    await grnSmartService.reverseConsumption(conn as any, "g1");
    expect(moves(budget.reverseConsumption)).toEqual([["L1", 60], ["L2", 40], ["L3", 30]]);
  });
});
