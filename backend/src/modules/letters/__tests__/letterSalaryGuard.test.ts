import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

import { stripSalaryOverrides, resolveApprovedIncrementVars } from "../letterSalaryGuard.js";

describe("stripSalaryOverrides", () => {
  it("drops every approved salary figure but keeps harmless typed values", () => {
    const out = stripSalaryOverrides("appointment", {
      basic: "99999", gross_salary: "99999", net_salary: "1", ctc: "1", epf: "0", note: "hello", hr_name: "A B",
    });
    expect(out).toEqual({ note: "hello", hr_name: "A B" });
  });

  it("also drops the increment figures when the letter is an increment letter", () => {
    const typed = { revised_ctc: "9,99,999", revised_fixed_ctc: "1", total_tctc: "1", variable_pay: "5", effective_date: "1 Jan 2030", review_year: "2030-31" };
    expect(stripSalaryOverrides("increment", typed)).toEqual({ review_year: "2030-31" });
    // other letter types may still carry an effective date (promotion does)
    expect(stripSalaryOverrides("promotion", { effective_date: "1 Jan 2030" })).toEqual({ effective_date: "1 Jan 2030" });
  });

  it("handles missing overrides", () => {
    expect(stripSalaryOverrides("increment", undefined)).toEqual({});
    expect(stripSalaryOverrides(null, null)).toEqual({});
  });
});

describe("resolveApprovedIncrementVars", () => {
  beforeEach(() => execute.mockReset());

  it("builds the figures from the approved, implemented increment (annual CTC, Indian grouping)", async () => {
    execute.mockResolvedValueOnce([[{ proposed_ctc: "199056.00", effective_from: "2026-07-11" }]]);
    const v = await resolveApprovedIncrementVars("emp-1");
    expect(v.revised_ctc).toBe("1,99,056");
    expect(v.revised_fixed_ctc).toBe("1,99,056");
    expect(v.total_tctc).toBe("1,99,056");
    expect(v.variable_pay).toBe("");
    expect(v.effective_date).toBe("11 Jul 2026");
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toMatch(/status = 'implemented'/);
    expect(sql).toMatch(/approved_at IS NOT NULL/);
    expect(sql).toMatch(/source = 'hrms'/); // a legacy migration row is not an increment
  });

  it("refuses with a 409 when no approved and implemented increment exists", async () => {
    execute.mockResolvedValueOnce([[]]);
    await expect(resolveApprovedIncrementVars("emp-2")).rejects.toMatchObject({ statusCode: 409 });
  });
});
