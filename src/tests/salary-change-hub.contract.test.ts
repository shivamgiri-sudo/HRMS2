import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("Salary Change & Increment is one page", () => {
  const hub = read("pages/payroll/SalaryChangeCenter.tsx");
  const panel = read("components/payroll/IncrementRequestsPanel.tsx");
  const picker = read("components/payroll/EmployeePicker.tsx");
  const incrementPage = read("pages/NativeSalaryIncrement.tsx");

  it("the hub has a Change salary tab and an Increment requests tab", () => {
    expect(hub).toContain("export function SalaryChangeHub");
    expect(hub).toContain("Change salary");
    expect(hub).toContain("Increment requests");
    expect(hub).toContain("<IncrementRequestsPanel />");
  });

  it("the old Salary Increment route opens the increment tab of the same hub (no separate page left)", () => {
    expect(incrementPage).toContain("SalaryChangeHub");
    expect(incrementPage).toContain('initialTab="increment"');
    expect(incrementPage).not.toContain("useMutation");
  });

  it("the new-request employee is typed and searched with the shared picker, not loaded as a dropdown of everyone", () => {
    expect(panel).toContain("<EmployeePicker");
    expect(panel).not.toContain("fetchAllEmployeeRows");
    expect(panel).not.toMatch(/SelectValue placeholder="Select employee"/);
    expect(hub).toContain("EmployeePicker");
    expect(picker).toContain("/api/employees?search=");
  });

  it("has no Finance step: the Payroll Head approves and the approval applies the increment", () => {
    expect(panel).not.toContain('action: "finance_validate"');
    expect(panel).not.toContain('label: "Finance Validate"');
    expect(panel).toContain("Approve & Apply");
  });
});
