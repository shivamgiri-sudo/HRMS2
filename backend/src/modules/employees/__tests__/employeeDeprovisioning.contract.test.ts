import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import { db } from "../../../db/mysql.js";
import { deprovisionEmployeeAccess } from "../../../shared/employeeDeprovisioning.js";
import { employeeService } from "../employee.service.js";

/**
 * Every exit silently skipped its own cleanup.
 *
 * exit.service's `exited` branch issued three statements against schema that
 * does not exist — `employee_asset_assignment` (no such table),
 * `lms_employee_mapping.active_status` (the column is `is_active`), and
 * `leave_requests` (the table is `leave_request`, and it has neither
 * `updated_at` nor `cancellation_reason`). Each was wrapped in a `.catch()`
 * that logged a warning, so the exit completed and reported success.
 *
 * Measured on production 2026-08-11: 60 people who have left are still active
 * LMS learners, and 2,185 pending/approved leave rows belong to leavers.
 */

const EXIT_SERVICE = path.resolve(__dirname, "../../exit/exit.service.ts");
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

interface Captured { sql: string; params: unknown[] }

function capture(): Captured[] {
  const calls: Captured[] = [];
  mockExecute.mockImplementation((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("SELECT user_id FROM employees")) return Promise.resolve([[{ user_id: "user-1" }], []]);
    if (sql.includes("FROM employees WHERE id = ?")) {
      return Promise.resolve([[{ id: "emp-1", employment_status: "Active", active_status: 1 }], []]);
    }
    if (sql.includes("COUNT(*) AS n FROM asset_assignment")) return Promise.resolve([[{ n: 3 }], []]);
    return Promise.resolve([{ affectedRows: 2 } as never, []]);
  });
  return calls;
}

describe("deprovisionEmployeeAccess uses schema that actually exists", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  it("revokes LMS access on the real column", async () => {
    const calls = capture();
    const result = await deprovisionEmployeeAccess("emp-1", "employee_exit");

    const lms = calls.find((c) => c.sql.includes("lms_employee_mapping"));
    expect(lms?.sql).toContain("is_active = 0");
    expect(lms?.sql).not.toContain("active_status");
    expect(lms?.sql).not.toContain("deprovisioned_at");
    expect(result.lmsMappingsRevoked).toBe(2);
  });

  it("cancels leave on the singular table, and only future-dated rows", async () => {
    const calls = capture();
    await deprovisionEmployeeAccess("emp-1", "employee_exit");

    const leave = calls.find((c) => /UPDATE leave_request\b/.test(c.sql));
    expect(leave).toBeDefined();
    expect(leave?.sql).not.toContain("leave_requests");
    expect(leave?.sql).not.toContain("cancellation_reason");
    expect(leave?.sql).not.toContain("updated_at");
    // Leave already taken is settled history — cancelling it would diverge from
    // attendance and payroll.
    expect(leave?.sql).toContain("> CURDATE()");
  });

  it("counts open assets rather than inventing a return", async () => {
    const calls = capture();
    const result = await deprovisionEmployeeAccess("emp-1", "employee_exit");

    expect(calls.some((c) => c.sql.includes("employee_asset_assignment"))).toBe(false);
    expect(result.openAssetAssignments).toBe(3);
    expect(calls.some((c) => /UPDATE asset_assignment/.test(c.sql))).toBe(false);
  });

  it("reports failures instead of swallowing them", async () => {
    mockExecute.mockRejectedValue(new Error("Table 'mas_hrms.lms_employee_mapping' doesn't exist"));

    const result = await deprovisionEmployeeAccess("emp-1", "employee_exit");

    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toContain("doesn't exist");
  });
});

describe("every deactivation path deprovisions", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  it("the DELETE path", async () => {
    const calls = capture();
    await employeeService.deactivateEmployee("emp-1", "hr-user", "Absconded since 1 Aug");
    expect(calls.some((c) => c.sql.includes("lms_employee_mapping"))).toBe(true);
  });

  it("the directory path HR actually uses", async () => {
    const calls = capture();
    await employeeService.updateEmployee(
      "emp-1",
      { employmentStatus: "Inactive", deactivationReason: "Resigned, LWD 15 Aug" } as never,
      "hr-user"
    );
    expect(calls.some((c) => c.sql.includes("lms_employee_mapping"))).toBe(true);
  });

  it("the exit flow — and its three dead statements are gone", () => {
    const code = fs.readFileSync(EXIT_SERVICE, "utf8");
    expect(code).toContain("deprovisionEmployeeAccess");
    expect(code).not.toMatch(/UPDATE employee_asset_assignment/);
    expect(code).not.toMatch(/UPDATE leave_requests/);
    expect(code).not.toMatch(/UPDATE lms_employee_mapping/);
  });
});
