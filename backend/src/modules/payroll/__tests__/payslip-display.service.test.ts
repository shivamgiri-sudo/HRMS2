import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("../../../db/mysql.js", () => ({
  db: { execute },
}));

vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn(),
}));

vi.mock("../../engagement/badge.service.js", () => ({
  queueAutoAwards: vi.fn(),
}));

describe("payslip display service", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("expands calculated prep lines even when no generated payslip row exists", async () => {
    execute
      .mockResolvedValueOnce([[
        {
          id: "line-1",
          prep_line_id: "line-1",
          run_id: "run-1",
          employee_id: "employee-1",
          run_month: "2026-06",
          gross_salary: 30000,
          net_salary: 27000,
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          component_code: "BASIC",
          component_name: "Basic",
          component_type: "earning",
          amount: "18000",
          taxable: 1,
        },
        {
          component_code: "PF",
          component_name: "Provident Fund",
          component_type: "deduction",
          amount: "1800",
          taxable: 0,
        },
      ], []]);

    const { payslipService } = await import("../payslip.service.js");
    const result = await payslipService.getPayslip("employee-1", "run-1");

    const detailQuery = String(execute.mock.calls[0][0]);
    expect(detailQuery).toContain("FROM salary_prep_line spl");
    expect(detailQuery).toContain("LEFT JOIN salary_payslip sp");
    expect(detailQuery).toContain("spl.employee_id = ?");
    expect(result.earnings).toHaveLength(1);
    expect(result.deductions).toHaveLength(1);
    expect(result.components).toHaveLength(2);
  });
});
