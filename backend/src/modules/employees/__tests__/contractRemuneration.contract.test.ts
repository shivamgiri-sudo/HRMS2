/**
 * The employment contract must state the real monthly remuneration.
 *
 * MAS63085's signed contract read "Rs. 0 (Rupees Zero only) per month". The
 * cause is in the data, not the template: employee_salary_snapshot.gross is 0
 * on 16,136 of 33,443 rows, because the write path fills the components and
 * leaves the summary column at its DEFAULT 0.
 *
 * A first fix fell back to ctc_offered/12. That is wrong here and worse than
 * the zero, because it prints a plausible number: ctc_offered on this table is
 * a MONTHLY figure on 31,095 of 31,118 rows that carry one (ratio to the
 * component sum < 2x). Dividing it by twelve would have put ₹1,382 on Harsh
 * Thakur's contract instead of ₹15,103 — an understatement a reader would
 * accept. So the fallback must be the component sum, which 15,518 of the 16,136
 * zero-gross rows actually carry.
 *
 * Figures below are MAS63085's real snapshot row, read from production.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: { salary: Record<string, unknown> | null; employee: Record<string, unknown> | null } = {
  salary: null,
  employee: null,
};

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("employee_salary_snapshot")) return [state.salary ? [state.salary] : []];
      if (s.includes("FROM employees")) return [state.employee ? [state.employee] : []];
      return [[]];
    }),
    query: vi.fn(async () => [[]]),
  },
}));

const { buildSourceContext } = await import("../universalDigitalFormFill.service.js");

/** MAS63085 (Harsh Thakur), NOIDA-2 — exactly as stored in production. */
const MAS63085_SNAPSHOT = {
  basic: 6041.2, hra: 2416.48, conveyance: 1600, da: 0,
  portfolio_allowance: 0, medical_allowance: 0, lta: 0, mobile_allowance: 0,
  special_allowance: 5045.32, other_allowance: 0, bonus: 0,
  gross: 0, net_in_hand: 0, ctc_offered: 16588,
};
const COMPONENT_SUM = 15103; // 6041.20 + 2416.48 + 1600 + 5045.32

beforeEach(() => {
  state.salary = null;
  state.employee = { full_name: "Harsh Thakur", gender: "Male", employee_code: "MAS63085" };
});

describe("monthly remuneration on the employment contract", () => {
  it("uses the component sum when the snapshot's gross column is zero", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    const ctx = await buildSourceContext("f228c0c1-92b4-4e04-8ef6-36a243aa69f9");
    const salary = (ctx as Record<string, Record<string, unknown>>).salary;

    expect(salary.monthly_gross).not.toBeNull();
    expect(String(salary.monthly_gross)).toContain("15,103");
    expect(String(salary.monthly_gross_words).toLowerCase()).not.toBe("zero");
    expect(String(salary.monthly_gross_words).toLowerCase()).toContain("fifteen thousand");
  });

  it("never divides ctc_offered by twelve — it is a monthly figure on this table", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    const ctx = await buildSourceContext("emp-1");
    const salary = (ctx as Record<string, Record<string, unknown>>).salary;
    // 16588/12 = 1382.33. If that number appears, the fallback is annualising
    // a monthly column and understating the salary by a factor of twelve.
    expect(String(salary.monthly_gross)).not.toContain("1,382");
  });

  it("falls back to ctc_offered as-is when no component carries a figure", async () => {
    state.salary = { ...MAS63085_SNAPSHOT, basic: 0, hra: 0, conveyance: 0, special_allowance: 0 };
    const ctx = await buildSourceContext("emp-2");
    const salary = (ctx as Record<string, Record<string, unknown>>).salary;
    expect(String(salary.monthly_gross)).toContain("16,588");
  });

  it("refuses an uncorroborated ctc_offered large enough to be an annual figure", async () => {
    // Five rows on this table hold 110,000-625,000 in a column that is monthly
    // on 31,100 of 31,142 rows. Those are almost certainly annual CTCs entered
    // in the wrong column. With no components to corroborate the figure there
    // is no way to tell, and printing one as a monthly salary overstates it
    // twelvefold on a document someone signs. A blank is the safe failure.
    state.salary = {
      ...MAS63085_SNAPSHOT,
      basic: 0, hra: 0, conveyance: 0, special_allowance: 0, ctc_offered: 625000,
    };
    const ctx = await buildSourceContext("emp-annual");
    expect((ctx as Record<string, Record<string, unknown>>).salary.monthly_gross).toBeNull();
  });

  it("still trusts a large figure when the components corroborate it", async () => {
    // A genuine senior salary must not be suppressed. Here the components say
    // the same thing, so there is nothing ambiguous about it.
    state.salary = {
      ...MAS63085_SNAPSHOT,
      basic: 250000, hra: 100000, conveyance: 0, special_allowance: 0, ctc_offered: 400000,
    };
    const ctx = await buildSourceContext("emp-senior");
    expect(String((ctx as Record<string, Record<string, unknown>>).salary.monthly_gross)).toContain("3,50,000");
  });

  it("prefers a real gross over the component sum when one is written", async () => {
    state.salary = { ...MAS63085_SNAPSHOT, gross: 20000 };
    const ctx = await buildSourceContext("emp-3");
    const salary = (ctx as Record<string, Record<string, unknown>>).salary;
    expect(String(salary.monthly_gross)).toContain("20,000");
  });

  it("stays null when the snapshot carries nothing at all", async () => {
    state.salary = {
      basic: 0, hra: 0, conveyance: 0, da: 0, portfolio_allowance: 0,
      medical_allowance: 0, lta: 0, mobile_allowance: 0, special_allowance: 0,
      other_allowance: 0, bonus: 0, gross: 0, net_in_hand: 0, ctc_offered: 0,
    };
    const ctx = await buildSourceContext("emp-4");
    const salary = (ctx as Record<string, Record<string, unknown>>).salary;
    // 594 rows are in this state. A blank is honest; a fabricated figure is not.
    expect(salary.monthly_gross).toBeNull();
  });
});

describe("s/o | d/o on the employment contract", () => {
  it("resolves to s/o for a male employee", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    state.employee = { full_name: "Harsh Thakur", gender: "Male" };
    const ctx = await buildSourceContext("emp-5");
    expect((ctx as Record<string, Record<string, unknown>>).employee.relation_prefix).toBe("s/o");
  });

  it("resolves to d/o for a female employee", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    state.employee = { full_name: "Priya Sharma", gender: "Female" };
    const ctx = await buildSourceContext("emp-6");
    expect((ctx as Record<string, Record<string, unknown>>).employee.relation_prefix).toBe("d/o");
  });

  it("keeps both forms when gender is unknown, rather than guessing", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    state.employee = { full_name: "A B", gender: null };
    const ctx = await buildSourceContext("emp-7");
    // 63 employees have no usable gender. Printing "s/o" for them would assert
    // something about a real person that the record does not support.
    expect((ctx as Record<string, Record<string, unknown>>).employee.relation_prefix).toBe("s/o | d/o");
  });
});
