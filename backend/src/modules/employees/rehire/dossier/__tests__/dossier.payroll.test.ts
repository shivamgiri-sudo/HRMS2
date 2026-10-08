import { describe, it, expect, vi } from "vitest";
import { loadPayrollSection } from "../dossier.payroll.js";
import { buildWindow } from "../dossierTypes.js";

function executor(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
const w = buildWindow("e1", "2026-09-10", 12);

describe("loadPayrollSection", () => {
  const slips = [
    { run_month: "2026-08", gross_salary: "22000", net_salary: "19000", total_deductions: "3000" },
    { run_month: "2026-07", gross_salary: "22000", net_salary: "18000", total_deductions: "4000" },
  ];

  it("summarises recent payslips: last net, average net", async () => {
    const ex = executor({
      "FROM salary_prep_line": slips,
      "FROM employee_salary_history": [{ gross: "22000", ctc: "300000" }],
      "FROM employee_loans": [{ total: "0" }],
      "FROM salary_advance_log": [{ total: "0" }],
      "FROM employee_deduction_entries": [{ total: "0" }],
    });
    const s = await loadPayrollSection(ex as never, w);
    expect(s.payslips).toHaveLength(2);
    expect(s.lastNet).toBe(19000);
    expect(s.avgNet).toBe(18500);
    expect(s.currentSalary).toEqual({ gross: 22000, ctc: 300000 });
  });

  it("only reads final payroll runs, never drafts", async () => {
    const ex = executor({ "FROM salary_prep_line": [] });
    await loadPayrollSection(ex as never, w);
    const sql = String(ex.execute.mock.calls.find(([s]) => String(s).includes("FROM salary_prep_line"))![0]);
    expect(sql).toMatch(/IN \('locked',\s*'finalized',\s*'approved',\s*'disbursed',\s*'completed'\)/i);
  });

  it("sums pending recoveries across loans, advances and deductions", async () => {
    const ex = executor({
      "FROM salary_prep_line": [],
      "FROM employee_loans": [{ total: "5000" }],
      "FROM salary_advance_log": [{ total: "1500" }],
      "FROM employee_deduction_entries": [{ total: "500" }],
    });
    const s = await loadPayrollSection(ex as never, w);
    expect(s.pendingRecoveries).toEqual({ loans: 5000, advances: 1500, deductions: 500, total: 7000 });
  });

  it("a failing recovery table degrades to null recoveries instead of failing the section", async () => {
    const ex = executor({
      "FROM salary_prep_line": slips,
      "FROM employee_loans": new Error("Unknown column"),
    });
    const s = await loadPayrollSection(ex as never, w);
    expect(s.lastNet).toBe(19000);
    expect(s.pendingRecoveries).toBeNull();
  });

  it("nulls when there are no payslips", async () => {
    const ex = executor({ "FROM salary_prep_line": [] });
    const s = await loadPayrollSection(ex as never, w);
    expect(s.lastNet).toBeNull();
    expect(s.avgNet).toBeNull();
  });
});
