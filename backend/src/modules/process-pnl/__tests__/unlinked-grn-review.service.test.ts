import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F1 classifier fix (Group E): the header-existence lookup in getUnlinkedGrnReview() previously
 * had no `status` filter on finance_budget_header, so a merely-draft/submitted header could be
 * misread as "a budget exists" and mask a true NO_BRANCH_BUDGET case — inconsistent with the live
 * GRN-creation gate (branch-budget.service.ts's getLineForGrn() / budget-headroom-gate.service.ts's
 * getHeadSubHeadCoverage(), both of which already require status = 'active').
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { getUnlinkedGrnReview } from "../unlinked-grn-review.service.js";

beforeEach(() => {
  execute.mockReset();
});

const GRN_ROW = {
  id: "grn-1",
  grn_number: "GRN/2026/0001",
  grn_type: "vendor",
  status: "approved",
  branch_id: "branch-noida-2",
  branch_name: "Noida-2",
  cost_centre_id: "cc-ops",
  cost_centre_name: "Operations",
  head: "Travel",
  sub_head: null,
  accounting_period: "2026-08",
  financial_year: "2026-27",
  amount_with_tax: 10000,
};

describe("getUnlinkedGrnReview — header status gate", () => {
  it("queries finance_budget_header with a status = 'active' filter", async () => {
    execute.mockResolvedValueOnce([[GRN_ROW], []]); // grns
    execute.mockResolvedValueOnce([[], []]); // headers
    execute.mockResolvedValueOnce([[], []]); // lines

    await getUnlinkedGrnReview({});

    const headerCall = execute.mock.calls.find(([sql]) =>
      String(sql).includes("FROM finance_budget_header"),
    );
    expect(headerCall).toBeDefined();
    expect(String(headerCall![0])).toContain("WHERE status = 'active'");
  });

  it("classifies a GRN as NO_BRANCH_BUDGET when the only header for that branch/period is 'submitted', not 'active'", async () => {
    execute.mockResolvedValueOnce([[GRN_ROW], []]); // grns
    // A real 'submitted' header row exists in the table, but the fixed query filters to
    // status='active' — the mock simulates that filter by returning no rows, exactly as the
    // real WHERE clause would for a submitted-only header.
    execute.mockResolvedValueOnce([[], []]); // headers (submitted header excluded by the fix)
    execute.mockResolvedValueOnce([[], []]); // lines

    const result = await getUnlinkedGrnReview({});

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].category).toBe("NO_BRANCH_BUDGET");
  });

  it("classifies the same GRN as NO_MATCHING_LINE (not NO_BRANCH_BUDGET) once an active header exists but no line covers it", async () => {
    execute.mockResolvedValueOnce([[GRN_ROW], []]); // grns
    execute.mockResolvedValueOnce([
      [{ id: "header-1", branch_id: "branch-noida-2", period_code: "2026-08" }],
      [],
    ]); // headers (active)
    execute.mockResolvedValueOnce([[], []]); // lines — none match this cost centre/head/sub-head

    const result = await getUnlinkedGrnReview({});

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].category).toBe("NO_MATCHING_LINE");
  });
});

describe("getUnlinkedGrnReview — HEADROOM_EXCEEDED shortfall is ex-GST on both sides", () => {
  it("measures the GRN's ex-GST amount against the line's ex-GST ceiling, as the approval gate does", async () => {
    // GRN 11,800 gross / 10,000 ex-GST; line base 9,000 (gross 10,620). Old basis: 11,800 − 10,620.
    execute.mockResolvedValueOnce([[{ ...GRN_ROW, amount_with_tax: 11800, amount_ex_gst: 10000 }], []]);
    execute.mockResolvedValueOnce([[{ id: "header-1", branch_id: "branch-noida-2", period_code: "2026-08" }], []]);
    execute.mockResolvedValueOnce([[{
      id: "line-1", budget_id: "header-1", cost_centre_id: "cc-ops", head: "Travel", sub_head: null,
      gross_amount: 10620, ceiling_ex_gst: 9000, reserved_amount: 0, consumed_amount: 0,
    }], []]);

    const result = await getUnlinkedGrnReview({});

    expect(result.rows[0].category).toBe("HEADROOM_EXCEEDED");
    expect(result.rows[0].shortfall).toBe(1000);
    const [grnSql] = execute.mock.calls[0];
    const [lineSql] = execute.mock.calls[2];
    expect(String(grnSql)).toContain("AS amount_ex_gst");
    expect(String(lineSql)).toContain("COALESCE(NULLIF(l.base_amount, 0)");
  });
});
