import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), getConnection: vi.fn() } }));
vi.mock("../branch-budget-allocation.service.js", async (orig) => ({
  ...(await orig<object>()),
  computeLineAllocations: vi.fn(async () => []),
  replaceLineAllocations: vi.fn(async () => undefined),
}));

import { replaceBudgetLines } from "../branch-budget.service.js";

const calc = (id: string | undefined, name: string) => ({
  line: { id, head: "Rent", subHead: "Office", itemName: name, unit: "nos", quantity: 1, unitRate: 100, taxTreatment: "taxable", gstRate: 18, justification: "x", planningLevel: "cost_centre" },
  values: { gstType: "intra", recoverablePct: 100, cgstAmount: 9, sgstAmount: 9, igstAmount: 0, baseAmount: 100, taxAmount: 18, grossAmount: 118, recoverableTaxAmount: 18, pnlCostAmount: 100 },
  attribution: { processId: null, costCentreId: null },
}) as never;

function conn(existingElsewhere: string[]) {
  const inserted: string[] = [];
  return {
    inserted,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/^\s*DELETE FROM finance_budget_line/.test(sql)) return [{}, []];
      if (/SELECT id FROM finance_budget_line WHERE id IN/.test(sql)) return [existingElsewhere.filter((i) => params.includes(i)).map((id) => ({ id })), []];
      if (/INSERT INTO finance_budget_line\b/.test(sql)) { inserted.push(String(params[0])); return [{}, []]; }
      return [[], []];
    }),
  };
}

describe("replaceBudgetLines id collisions", () => {
  it("gives a line whose id belongs to another budget a fresh id; keeps the rest", async () => {
    const c = conn(["15a82cb6-18fa-421b-94f5-5456f3e61b10"]);
    await replaceBudgetLines(c as never, "b1", "br", "2026-11", [
      calc("15a82cb6-18fa-421b-94f5-5456f3e61b10", "copied"), calc("own-line", "own"), calc(undefined, "new"),
    ], "u");
    expect(c.inserted).toHaveLength(3);
    expect(c.inserted).not.toContain("15a82cb6-18fa-421b-94f5-5456f3e61b10");
    expect(c.inserted).toContain("own-line");
    expect(new Set(c.inserted).size).toBe(3);
  });
});
