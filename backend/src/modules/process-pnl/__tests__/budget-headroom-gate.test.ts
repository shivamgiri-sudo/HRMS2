import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Budget-headroom-gate module (Group C, step 1) — standalone, not wired into any GRN call site.
 *
 * Covers: coverage lookup aggregates every branch-wide line for a head+sub-head (clamping
 * over-consumed lines to 0, matching head/sub-head case/whitespace-insensitively, and never
 * querying lines when there is no active header) and the pure allocator that splits a requested
 * amount across those lines (preferred line first, direct-cost-centre lines before pooled ones,
 * largest-available-first within each group, throwing HEADROOM_EXCEEDED with a numeric
 * `shortfall` when the branch aggregate cannot cover the request).
 */

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

import { allocateAcrossLines, getHeadSubHeadCoverage } from "../budget-headroom-gate.service.js";

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
});

describe("getHeadSubHeadCoverage", () => {
  it("returns headerActive: false and never queries lines when there is no active header", async () => {
    execute.mockResolvedValueOnce([[], []]); // header lookup: no rows

    const result = await getHeadSubHeadCoverage("branch-1", "2026-08", "Travel", null);

    expect(result).toEqual({ headerActive: false, lines: [], aggregateAvailable: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql] = execute.mock.calls[0];
    expect(String(sql)).not.toMatch(/finance_budget_line/);
  });

  it("aggregates a direct line and a pooled line for the same head+sub-head", async () => {
    execute.mockResolvedValueOnce([[{ id: "header-1" }], []]); // header lookup
    execute.mockResolvedValueOnce([
      [
        { id: "line-direct", cost_centre_id: "cc-1", available_gross_amount: 5000 },
        { id: "line-pooled", cost_centre_id: null, available_gross_amount: 3000 },
      ],
      [],
    ]);

    const result = await getHeadSubHeadCoverage("branch-1", "2026-08", "Travel", "Local");

    expect(result.headerActive).toBe(true);
    expect(result.lines.length).toBe(2);
    expect(result.aggregateAvailable).toBe(8000);
  });

  it("clamps an over-consumed line's contribution to 0 rather than letting it drag the total negative", async () => {
    execute.mockResolvedValueOnce([[{ id: "header-1" }], []]);
    execute.mockResolvedValueOnce([
      [
        { id: "line-over", cost_centre_id: "cc-1", available_gross_amount: -500 },
        { id: "line-healthy", cost_centre_id: "cc-2", available_gross_amount: 2000 },
      ],
      [],
    ]);

    const result = await getHeadSubHeadCoverage("branch-1", "2026-08", "Travel", null);

    expect(result.aggregateAvailable).toBe(2000);
  });

  it("matches head/sub-head case/whitespace-insensitively", async () => {
    // Simulates what UPPER(TRIM(...)) = UPPER(TRIM(?)) would actually do in MySQL, so the test
    // proves the query normalizes both the stored value and the bound parameter, not just one.
    const storedLines = [{ id: "line-1", head: " Travel ", sub_head: null, cost_centre_id: null, available_gross_amount: 1000 }];
    const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase();

    execute.mockResolvedValueOnce([[{ id: "header-1" }], []]);
    execute.mockImplementationOnce(async (sql: string, params: unknown[]) => {
      expect(String(sql)).toMatch(/UPPER\(TRIM\(l\.head\)\)/);
      const [, queriedHead, queriedSubHead] = params;
      const matched = storedLines.filter(
        (line) =>
          normalize(line.head) === normalize(queriedHead) &&
          normalize(line.sub_head) === normalize(queriedSubHead)
      );
      return [matched, []];
    });

    const result = await getHeadSubHeadCoverage("branch-1", "2026-08", "travel", null);

    expect(result.lines.length).toBe(1);
    expect(result.aggregateAvailable).toBe(1000);
  });
});

describe("allocateAcrossLines", () => {
  const line = (id: string, availableGrossAmount: number, costCentreId: string | null = "cc-x") => ({
    id,
    cost_centre_id: costCentreId,
    available_gross_amount: availableGrossAmount,
  });

  it("draws entirely from the preferred line when it fully covers the amount", () => {
    const lines = [line("preferred", 5000), line("other", 5000)];

    const draws = allocateAcrossLines("preferred", 3000, lines as any);

    expect(draws).toEqual([{ lineId: "preferred", amount: 3000 }]);
  });

  it("falls back to a sibling direct line for the remainder after the preferred line runs out", () => {
    const lines = [line("preferred", 1000), line("sibling", 5000)];

    const draws = allocateAcrossLines("preferred", 3000, lines as any);

    expect(draws).toEqual([
      { lineId: "preferred", amount: 1000 },
      { lineId: "sibling", amount: 2000 },
    ]);
  });

  it("with no preferred line, starts from the highest-available direct line, falling back to pooled", () => {
    // Direct lines are drawn before pooled ones regardless of amount, so exhausting BOTH direct
    // lines (4000 + 1000 = 5000 available) is what forces the draw to spill into the pooled line.
    const lines = [
      line("direct-low", 1000, "cc-1"),
      line("direct-high", 4000, "cc-2"),
      line("pooled", 9000, null),
    ];

    const draws = allocateAcrossLines(null, 4500, lines as any);

    expect(draws).toEqual([
      { lineId: "direct-high", amount: 4000 },
      { lineId: "direct-low", amount: 500 },
    ]);

    const drawsSpillingIntoPooled = allocateAcrossLines(null, 5500, lines as any);
    expect(drawsSpillingIntoPooled).toEqual([
      { lineId: "direct-high", amount: 4000 },
      { lineId: "direct-low", amount: 1000 },
      { lineId: "pooled", amount: 500 },
    ]);
  });

  it("draws from a direct line before a pooled line even when the pooled line has more available", () => {
    const lines = [line("pooled", 10_000, null), line("direct", 100, "cc-1")];

    const draws = allocateAcrossLines(null, 50, lines as any);

    expect(draws).toEqual([{ lineId: "direct", amount: 50 }]);
  });

  it("throws HEADROOM_EXCEEDED with the actual shortfall when total availability is insufficient", () => {
    const lines = [line("a", 1000), line("b", 500)];

    let caught: any;
    try {
      allocateAcrossLines(null, 2000, lines as any);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(caught.statusCode).toBe(409);
    expect(caught.code).toBe("HEADROOM_EXCEEDED");
    expect(caught.shortfall).toBe(500);
    expect(caught.message).toMatch(/500\.00/);
  });

  it("throws HEADROOM_EXCEEDED with the full requested amount as shortfall when lines is empty", () => {
    let caught: any;
    try {
      allocateAcrossLines("preferred", 1500, []);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(caught.statusCode).toBe(409);
    expect(caught.code).toBe("HEADROOM_EXCEEDED");
    expect(caught.shortfall).toBe(1500);
  });
});
