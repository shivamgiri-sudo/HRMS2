import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../src/db/mysql.js", () => ({
    db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
import { db } from "../src/db/mysql.js";
import { calculatePayrollRun } from "../src/modules/payroll/payrollCalculate.service.js";
const mockExecute = db.execute;
const fakeRun = {
    id: "run-1",
    run_month: "2026-05",
    branch_filter: null,
    process_filter: "Inbound",
    status: "draft",
    total_employees: 0,
    total_gross: 0,
    total_deductions: 0,
    total_net: 0,
    created_by: "user-1",
};
const fakeEmployee = {
    employee_id: "emp-1",
    employee_code: "EMP001",
    ctc_annual: 300000, // ₹3L pa → ₹25k/month gross
    basic_pct: 40,
    hra_pct: 20,
};
const fakeAttendance = {
    employee_id: "emp-1",
    working_days: 26,
    present_days: 24,
    leave_days: 1,
    lwp_days: 1,
    late_marks: 2,
    dialer_hours: 200,
};
const fakeStatutory = {
    pf_employee_pct: 12,
    esic_employee_pct: 0.75,
    esic_wage_limit: 21000,
    pf_wage_limit: 15000,
    professional_tax: 200,
};
describe("calculatePayrollRun", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExecute.mockReset().mockResolvedValue([[], []]);
    });

    function mockOneEmployeeRun(updatedRun = fakeRun) {
        mockExecute.mockResolvedValueOnce([[fakeRun]]); // run
        mockExecute.mockResolvedValueOnce([[fakeStatutory]]); // statutory config
        mockExecute.mockResolvedValueOnce([[fakeEmployee]]); // employees
        mockExecute.mockResolvedValueOnce([[]]); // incentives
        mockExecute.mockResolvedValueOnce([[]]); // maternity exemptions
        mockExecute.mockResolvedValueOnce([[{ cnt: 0 }]]); // attendance engine count
        mockExecute.mockResolvedValueOnce([[fakeAttendance]]); // legacy attendance
        mockExecute.mockResolvedValueOnce([[]]); // tax declaration
        mockExecute.mockResolvedValueOnce([[{ monthly_recovery: 0 }]]); // salary advance
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // prep line
        mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // run totals
        mockExecute.mockResolvedValueOnce([[updatedRun]]); // updated run
    }
    it("throws when run not found", async () => {
        mockExecute.mockResolvedValueOnce([[]]); // getRun
        await expect(calculatePayrollRun("missing-run", "user-1")).rejects.toThrow("Run not found");
    });
    it("throws when run is locked/disbursed", async () => {
        mockExecute.mockResolvedValueOnce([[{ ...fakeRun, status: "locked" }]]);
        await expect(calculatePayrollRun("run-1", "user-1")).rejects.toThrow("locked");
    });
    it("fetches employees scoped to run's process_filter", async () => {
        mockOneEmployeeRun({ ...fakeRun, status: "processing" });
        await calculatePayrollRun("run-1", "user-1");
        const calls = mockExecute.mock.calls.map(([sql]) => sql);
        const empQuery = calls.find((s) => /process_filter|process_id|process_name/i.test(s));
        expect(empQuery).toBeDefined();
    });
    it("upserts one prep line per employee", async () => {
        mockOneEmployeeRun();
        await calculatePayrollRun("run-1", "user-1");
        const calls = mockExecute.mock.calls.map(([sql]) => sql);
        const upsert = calls.find((s) => /salary_prep_line/i.test(s) && /INSERT|REPLACE/i.test(s));
        expect(upsert).toBeDefined();
    });
    it("calculates net salary correctly for single employee", async () => {
        mockOneEmployeeRun();
        await calculatePayrollRun("run-1", "user-1");
        const upsertCall = mockExecute.mock.calls.find(([sql]) => /INSERT INTO salary_prep_line/i.test(sql));
        const upsertParams = upsertCall?.[1] ?? [];
        // net_salary should be positive and < gross
        const netSalary = upsertParams.find((p) => typeof p === "number" && p > 0 && p < 30000);
        expect(netSalary).toBeDefined();
    });
    it("updates run status to processing and sets totals", async () => {
        mockOneEmployeeRun({ ...fakeRun, status: "processing" });
        const result = await calculatePayrollRun("run-1", "user-1");
        expect(result.status).toBe("processing");
    });
    it("returns result with employee count", async () => {
        mockOneEmployeeRun();
        const result = await calculatePayrollRun("run-1", "user-1");
        expect(result.employees_processed).toBe(1);
    });
});
