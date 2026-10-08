/**
 * The employment contract prints ONLY the salary the Payroll Head approved.
 *
 * Owner rule 2026-10-05: letters carry figures the Payroll Head approved, nothing else. The appendix used to
 * fall back to the salary snapshot, a component sum, then the offered CTC when no approved package existed
 * (a fix for a contract that once read "Rs. 0"). Those are unapproved numbers, so they are gone: with no
 * approved + accepted package the figure is blank and the joining kit stays blocked until approval.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  salary: Record<string, unknown> | null;
  employee: Record<string, unknown> | null;
  approvedPackage: Record<string, unknown> | null;
} = { salary: null, employee: null, approvedPackage: null };

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("employee_payroll_head_review")) return [state.approvedPackage ? [state.approvedPackage] : []];
      if (s.includes("employee_salary_snapshot")) return [state.salary ? [state.salary] : []];
      if (s.includes("FROM employees")) return [state.employee ? [state.employee] : []];
      return [[]];
    }),
    query: vi.fn(async () => [[]]),
  },
}));

const { buildSourceContext } =
  await import("../universalDigitalFormFill.service.js");

/** MAS63085's real snapshot row: unapproved figures that must never reach the contract. */
const MAS63085_SNAPSHOT = {
  basic: 6041.2, hra: 2416.48, conveyance: 1600, da: 0,
  portfolio_allowance: 0, medical_allowance: 0, lta: 0, mobile_allowance: 0,
  special_allowance: 5045.32, other_allowance: 0, bonus: 0,
  gross: 20000, net_in_hand: 18000, ctc_offered: 16588,
};

beforeEach(() => {
  state.salary = null;
  state.approvedPackage = null;
  state.employee = { full_name: "Harsh Thakur", gender: "Male", employee_code: "MAS63085" };
});

const salaryOf = (ctx: unknown) => (ctx as Record<string, Record<string, unknown>>).salary;

describe("monthly remuneration on the employment contract", () => {
  it("prints the Payroll Head's approved package figure", async () => {
    state.approvedPackage = { package_gross: 15059 };
    state.salary = { ...MAS63085_SNAPSHOT }; // a different, unapproved snapshot must be ignored
    const salary = salaryOf(await buildSourceContext("emp-approved"));
    expect(String(salary.monthly_gross)).toContain("15,059");
    expect(String(salary.monthly_gross_words).toLowerCase()).toContain("fifteen thousand");
    expect(salary.ctc_annual).toBe(15059 * 12);
  });

  it("is blank when there is no approved package, even if the snapshot carries a gross", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    const salary = salaryOf(await buildSourceContext("emp-unapproved"));
    expect(salary.monthly_gross).toBeNull();
    expect(salary.monthly_gross_words).toBeNull();
    expect(salary.ctc_annual).toBeNull();
  });

  it("does not fall back to the component sum or the offered CTC", async () => {
    state.salary = { ...MAS63085_SNAPSHOT, gross: 0 };
    const salary = salaryOf(await buildSourceContext("emp-no-gross"));
    expect(salary.monthly_gross).toBeNull(); // component sum 15,103 and ctc_offered 16,588 are both unapproved
  });

  it("exposes no snapshot components, gross, net or statutory amounts to templates", async () => {
    state.approvedPackage = { package_gross: 15059 };
    state.salary = { ...MAS63085_SNAPSHOT };
    const salary = salaryOf(await buildSourceContext("emp-fields"));
    for (const k of ["basic", "hra", "conveyance", "special_allowance", "bonus", "gross", "net_in_hand", "epf_employee", "esic_employee", "admin_charges"]) {
      expect(salary).not.toHaveProperty(k);
    }
  });
});

describe("s/o | d/o on the employment contract", () => {
  it("resolves to s/o for a male employee", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    state.employee = { full_name: "Harsh Thakur", gender: "Male" };
    const ctx = await buildSourceContext("emp-5");
    expect(
      (ctx as Record<string, Record<string, unknown>>).employee.relation_prefix,
    ).toBe("s/o");
  });

  it("resolves to d/o for a female employee", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    state.employee = { full_name: "Priya Sharma", gender: "Female" };
    const ctx = await buildSourceContext("emp-6");
    expect(
      (ctx as Record<string, Record<string, unknown>>).employee.relation_prefix,
    ).toBe("d/o");
  });

  it("keeps both forms when gender is unknown, rather than guessing", async () => {
    state.salary = { ...MAS63085_SNAPSHOT };
    state.employee = { full_name: "A B", gender: null };
    const ctx = await buildSourceContext("emp-7");
    // 63 employees have no usable gender. Printing "s/o" for them would assert
    // something about a real person that the record does not support.
    expect(
      (ctx as Record<string, Record<string, unknown>>).employee.relation_prefix,
    ).toBe("s/o | d/o");
  });
});
