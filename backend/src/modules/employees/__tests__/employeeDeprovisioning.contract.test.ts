import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import { db } from "../../../db/mysql.js";

// Leave cancellation is routed through leaveService.reviewRequest() (2026-08-13 audit) so
// balance-restore and attendance-revert run the same way every other cancellation path
// uses it, instead of a raw UPDATE that left leave_balance_ledger/attendance_daily_record
// disagreeing with leave_request.status. reviewRequest itself does its own locking,
// transaction and balance-restore work — genuinely tested in leave.service's own suite —
// so this file mocks it rather than re-deriving its whole internal SQL surface here.
const { reviewRequestMock } = vi.hoisted(() => ({ reviewRequestMock: vi.fn() }));
vi.mock("../../leave/leave.service.js", () => ({
  leaveService: { reviewRequest: reviewRequestMock },
}));

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
    if (sql.includes("SELECT id FROM leave_request")) return Promise.resolve([[{ id: "leave-1" }, { id: "leave-2" }], []]);
    return Promise.resolve([{ affectedRows: 2 } as never, []]);
  });
  return calls;
}

describe("deprovisionEmployeeAccess uses schema that actually exists", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
    reviewRequestMock.mockReset();
    reviewRequestMock.mockResolvedValue({});
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

  it("cancels leave on the singular table, only future-dated rows, through reviewRequest", async () => {
    const calls = capture();
    const result = await deprovisionEmployeeAccess("emp-1", "employee_exit");

    // The candidate lookup: singular table, future-dated only.
    const select = calls.find((c) => /SELECT id FROM leave_request\b/.test(c.sql));
    expect(select).toBeDefined();
    expect(select?.sql).not.toContain("leave_requests");
    // Leave already taken is settled history — cancelling it would diverge from
    // attendance and payroll.
    expect(select?.sql).toContain("> CURDATE()");

    // No raw UPDATE against leave_request — cancellation goes through reviewRequest()
    // so balance-restore and attendance-revert run instead of leaving leave_balance_ledger
    // and attendance_daily_record disagreeing with a directly-flipped status (2026-08-13 audit).
    expect(calls.some((c) => /UPDATE leave_request\b/.test(c.sql))).toBe(false);

    // Every candidate id from the SELECT gets reviewed as cancelled, by the system actor.
    expect(reviewRequestMock).toHaveBeenCalledTimes(2);
    expect(reviewRequestMock).toHaveBeenCalledWith(
      "leave-1", { status: "cancelled", remarks: "employee_exit" }, "system:employeeDeprovisioning"
    );
    expect(reviewRequestMock).toHaveBeenCalledWith(
      "leave-2", { status: "cancelled", remarks: "employee_exit" }, "system:employeeDeprovisioning"
    );
    expect(result.leaveRequestsCancelled).toBe(2);
  });

  it("surfaces a partial reviewRequest failure without losing the rows that did cancel", async () => {
    capture();
    reviewRequestMock.mockImplementation(async (id: string) => {
      if (id === "leave-2") throw new Error("This leave request was already moved to 'cancelled'.");
      return {};
    });

    const result = await deprovisionEmployeeAccess("emp-1", "employee_exit");

    expect(result.leaveRequestsCancelled).toBe(1);
    expect(result.failures.some((f) => f.includes("leave-2"))).toBe(true);
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
