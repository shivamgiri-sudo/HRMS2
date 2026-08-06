import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * resolveSeatRate() (per-employee, exported for future per-employee consumers) and
 * getSeatRevenueActuals() (batched, feeds P&L actuals) are documented as needing to
 * resolve a seat rate through the same precedence, in the same order — pnl-actuals.
 * service.ts's own doc comment names a `seat-revenue.precedence.test.ts` that was
 * supposed to guard exactly this, over identical fixtures. That file never existed.
 *
 * In the meantime resolveSeatRate() drifted: it never checked
 * process_role_billability.seat_rate_monthly, a real tier the batched query's COALESCE
 * already included (1065_billability_seat_cost.sql:69-70 confirms the column is
 * intentional, not vestigial). resolveSeatRate() currently has no callers anywhere in
 * the codebase — this is not (yet) an active production discrepancy between two
 * screens, but the drift is real and would misfire the moment something calls it.
 *
 * This is the test the comment describes, in the style already established in this
 * directory (prior-budget-mirror.test.ts): db.execute mocked and asserted on directly,
 * plus source-text checks locking the precedence order into the SQL itself.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

/**
 * Imported statically, not with `await import()` inside each test.
 *
 * vi.mock is hoisted above the imports, so a static import still receives the mocked db —
 * the dynamic form bought nothing and cost the suite real failures. Only the first test
 * to run pays for the module transform, and under the full 44-file parallel run that
 * import alone exceeded the 5s testTimeout. Worse, a timed-out test's continuation keeps
 * running: it went on to call execute and swallowed the NEXT test's queued
 * mockResolvedValueOnce, so "tier 2/3" failed with employee_override for a fixture it
 * never asked for. Both symptoms came from importing here rather than at module load.
 */
import { resolveSeatRate } from "../billability.service.js";

const EMPLOYEE = {
  employeeId: "emp-1",
  processId: "proc-1",
  designationId: "desig-1",
  costCentreId: "cc-1",
  pnlBucket: "agent_salary",
};

beforeEach(() => {
  execute.mockReset();
});

describe("resolveSeatRate precedence", () => {
  it("tier 1: employee override wins outright", async () => {
    execute.mockResolvedValueOnce([[{ id: "r1", seat_rate_monthly: "50000.00", proration_method: "payable_days" }], []]);
    const result = await resolveSeatRate(EMPLOYEE, "2026-08-15", "2026-08");
    expect(result).toEqual({
      seatRateMonthly: 50000,
      source: "employee_override",
      ruleId: "r1",
      prorationMethod: "payable_days",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("tier 2/3: cost-centre rate (designation-specific) wins over the process-role tier", async () => {
    execute
      .mockResolvedValueOnce([[], []]) // no employee override
      .mockResolvedValueOnce([[{ id: "r2", seat_rate_monthly: "40000.00", designation_id: "desig-1", billing_model: "per_seat", proration_method: "payable_days" }], []]);
    const result = await resolveSeatRate(EMPLOYEE, "2026-08-15", "2026-08");
    expect(result.source).toBe("cc_designation");
    expect(result.seatRateMonthly).toBe(40000);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("tier 4 (previously missing): falls through to process_role_billability.seat_rate_monthly when no override or cost-centre rate exists", async () => {
    execute
      .mockResolvedValueOnce([[], []]) // no employee override
      .mockResolvedValueOnce([[], []]) // no cost-centre rate
      .mockResolvedValueOnce([[{ id: "r4", seat_rate_monthly: "35000.00" }], []]); // process_role_billability
    const result = await resolveSeatRate(EMPLOYEE, "2026-08-15", "2026-08");
    expect(result).toEqual({
      seatRateMonthly: 35000,
      source: "process_role_rate",
      ruleId: "r4",
      prorationMethod: "payable_days",
    });
    expect(execute).toHaveBeenCalledTimes(3);
    // Exact (process, designation) match — mirrors getSeatRevenueActuals()'s join, not
    // resolveBillability()'s more flexible OR-NULL specificity fallback.
    const [sql, params] = execute.mock.calls[2];
    expect(String(sql)).toContain("FROM process_role_billability");
    expect(String(sql)).toContain("process_id = ? AND designation_id = ?");
    expect(params).toEqual(["proc-1", "desig-1", "2026-08-15", "2026-08-15"]);
  });

  it("still falls through to the monthly driver when process_role_billability has no rate either", async () => {
    execute
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]) // no process-role rate
      .mockResolvedValueOnce([[{ id: "r5", revenue_rate_per_head: "20000.00" }], []]);
    const result = await resolveSeatRate(EMPLOYEE, "2026-08-15", "2026-08");
    expect(result.source).toBe("monthly_driver");
    expect(result.seatRateMonthly).toBe(20000);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("resolves to missing when nothing matches at any tier", async () => {
    execute.mockResolvedValue([[], []]);
    const result = await resolveSeatRate(EMPLOYEE, "2026-08-15", "2026-08");
    expect(result.source).toBe("missing");
    expect(result.seatRateMonthly).toBe(0);
  });
});

describe("resolveSeatRate and getSeatRevenueActuals agree on precedence order", () => {
  const batchedSource = readFileSync(
    resolve(process.cwd(), "src/modules/process-pnl/pnl-actuals.service.ts"),
    "utf8",
  );
  const perEmployeeSource = readFileSync(
    resolve(process.cwd(), "src/modules/process-pnl/billability.service.ts"),
    "utf8",
  );

  it("the batched COALESCE still orders: override, cc-designation, cc-flat, process-role, driver", () => {
    const m = batchedSource.match(/COALESCE\(([^)]+)\) AS rate/);
    expect(m, "rate COALESCE expression not found in getSeatRevenueActuals").toBeTruthy();
    const args = m![1].split(",").map((s) => s.trim());
    expect(args).toEqual([
      "ovr.seat_rate_monthly",
      "ccd.seat_rate_monthly",
      "ccf.seat_rate_monthly",
      "m.seat_rate_monthly",
      "drv.revenue_rate_per_head",
    ]);
  });

  it("resolveSeatRate queries the same four rate sources, in the same order", () => {
    const fn = perEmployeeSource.match(/export async function resolveSeatRate[\s\S]*?\n\}/);
    expect(fn, "resolveSeatRate function body not found").toBeTruthy();
    const body = fn![0];
    const order = ["employee_seat_rate_override", "cost_centre_seat_rate", "process_role_billability", "finance_cost_centre_monthly_driver"]
      .map((table) => ({ table, idx: body.indexOf(`FROM ${table}`) }));
    for (const { table, idx } of order) {
      expect(idx, `resolveSeatRate no longer queries ${table}`).toBeGreaterThan(-1);
    }
    const indices = order.map((o) => o.idx);
    expect(indices, "resolveSeatRate's query order no longer matches getSeatRevenueActuals' COALESCE order").toEqual(
      [...indices].sort((a, b) => a - b),
    );
  });
});
