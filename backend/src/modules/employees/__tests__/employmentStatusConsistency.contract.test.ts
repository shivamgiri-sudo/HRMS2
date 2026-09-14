import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import { db } from "../../../db/mysql.js";
import { employeeService } from "../employee.service.js";

/**
 * employment_status and active_status describe one fact in two columns, and
 * PATCH /api/employees/:id only ever wrote the first.
 *
 * So HR marking a leaver "Inactive" in the employee directory dropped them from
 * payroll — which reads employment_status — while every access gate kept reading
 * active_status = 1 and letting them in. Measured on production 2026-08-10: one
 * employee in exactly that split state, and ten in the mirror image, labelled
 * active with a login already dead.
 *
 * Without the fix, the UPDATE these tests capture contains no active_status and
 * no session revocation follows it.
 */

const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

interface Captured { sql: string; params: unknown[] }

/**
 * Answer every query by shape and record what was asked. The employee row is
 * whatever the test declares; anything else comes back empty.
 */
function stubEmployee(row: Record<string, unknown>): Captured[] {
  const calls: Captured[] = [];
  mockExecute.mockImplementation((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    // Order matters: the session-revocation lookup is also a SELECT ... FROM
    // employees WHERE id = ?, so it has to be matched before the general case or
    // it receives the profile row, finds no user_id, and silently skips.
    if (sql.includes("SELECT user_id FROM employees")) return Promise.resolve([[{ user_id: "user-1" }], []]);
    if (sql.includes("FROM employees WHERE id = ?")) return Promise.resolve([[row], []]);
    return Promise.resolve([[{ affectedRows: 1 }], []]);
  });
  return calls;
}

/** A deactivation the API will accept: status plus the now-mandatory reason. */
const REASONED = { employmentStatus: "Inactive", deactivationReason: "Resigned, LWD 15 Aug" };

const employeeUpdate = (calls: Captured[]) =>
  calls.find((c) => c.sql.startsWith("UPDATE employees SET"));

describe("Marking an employee inactive also closes their access", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  it("writes active_status = 0 alongside employment_status", async () => {
    const calls = stubEmployee({ id: "emp-1", employment_status: "Active", active_status: 1 });

    await employeeService.updateEmployee("emp-1", REASONED as never, "hr-user");

    const update = employeeUpdate(calls);
    expect(update?.sql).toContain("employment_status = ?");
    expect(update?.sql).toContain("active_status = 0");
  });

  it("revokes the leaver's live sessions", async () => {
    const calls = stubEmployee({ id: "emp-2", employment_status: "Active", active_status: 1 });

    await employeeService.updateEmployee("emp-2", REASONED as never, "hr-user");

    expect(calls.some((c) => c.sql.includes("UPDATE auth_refresh_token SET revoked = 1"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("UPDATE user_device_sessions SET revoked_at"))).toBe(true);
  });

  it("audits the status change", async () => {
    const calls = stubEmployee({ id: "emp-3", employment_status: "Active", active_status: 1 });

    await employeeService.updateEmployee("emp-3", REASONED as never, "hr-user");

    const audit = calls.find((c) => c.sql.includes("INSERT INTO sensitive_action_log"));
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit?.params)).toContain("Employment Status");
  });

  it("leaves an already-inactive employee alone rather than revoking twice", async () => {
    const calls = stubEmployee({ id: "emp-4", employment_status: "Inactive", active_status: 0 });

    await employeeService.updateEmployee("emp-4", REASONED as never, "hr-user");

    expect(calls.some((c) => c.sql.includes("UPDATE auth_refresh_token"))).toBe(false);
  });
});

describe("A deactivation has to say why", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  it("refuses to deactivate with no reason", async () => {
    const calls = stubEmployee({ id: "emp-7", employment_status: "Active", active_status: 1 });

    await expect(
      employeeService.updateEmployee("emp-7", { employmentStatus: "Inactive" } as never, "hr-user")
    ).rejects.toMatchObject({ statusCode: 400, code: "DEACTIVATION_REASON_REQUIRED" });

    expect(employeeUpdate(calls)).toBeUndefined();
  });

  it("refuses a token reason", async () => {
    stubEmployee({ id: "emp-8", employment_status: "Active", active_status: 1 });

    await expect(
      employeeService.updateEmployee(
        "emp-8",
        { employmentStatus: "Inactive", deactivationReason: "left" } as never,
        "hr-user"
      )
    ).rejects.toMatchObject({ code: "DEACTIVATION_REASON_REQUIRED" });
  });

  it("records the reason in the audit row", async () => {
    const calls = stubEmployee({ id: "emp-9", employment_status: "Active", active_status: 1 });

    await employeeService.updateEmployee("emp-9", REASONED as never, "hr-user");

    const audit = calls.find((c) => c.sql.includes("INSERT INTO sensitive_action_log"));
    expect(JSON.stringify(audit?.params)).toContain("Resigned, LWD 15 Aug");
  });
});

describe("The delete endpoint — the one path that always did revoke access", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../employee.service.ts"),
    "utf8"
  );
  const deactivateFn = src.slice(src.indexOf("async deactivateEmployee("));

  it("writes an audit row naming the actor — source uses await logSensitiveAction not void", () => {
    // Using void means the INSERT fires but the caller cannot observe it synchronously.
    // Deactivation audit is compliance-critical, so the call must be awaited.
    const auditCallIdx = deactivateFn.indexOf("logSensitiveAction(");
    expect(auditCallIdx).toBeGreaterThan(-1);
    const prefix = deactivateFn.slice(Math.max(0, auditCallIdx - 40), auditCallIdx);
    expect(prefix).toContain("await ");
    expect(prefix).not.toContain("void ");

    // The action type and reason are in the call
    const callBody = deactivateFn.slice(auditCallIdx, auditCallIdx + 700);
    expect(callBody).toContain("EMPLOYEE_DEACTIVATED");
    expect(callBody).toContain("actor_user_id");
    expect(callBody).toContain("reason: trimmedReason");
  });

  it("refuses to run without a reason — source guard is present before any DB write", () => {
    // The reason guard must appear BEFORE the UPDATE statement, so a no-reason call
    // throws before touching any row.
    const reasonGuardIdx = deactivateFn.indexOf("DEACTIVATION_REASON_REQUIRED");
    const updateIdx = deactivateFn.indexOf("UPDATE employees SET active_status = 0");
    expect(reasonGuardIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(reasonGuardIdx).toBeLessThan(updateIdx);
  });
});

describe("Reactivation cannot be done by editing a profile", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  it("refuses to flip a deactivated employee back to Active", async () => {
    const calls = stubEmployee({ id: "emp-5", employment_status: "Inactive", active_status: 0 });

    await expect(
      employeeService.updateEmployee("emp-5", { employmentStatus: "Active" } as never, "hr-user")
    ).rejects.toMatchObject({ statusCode: 409, code: "REACTIVATION_REQUIRES_APPROVAL" });

    // and nothing was written
    expect(employeeUpdate(calls)).toBeUndefined();
  });

  it("does not brick edits on a record already labelled Active but carrying active_status = 0", async () => {
    // Ten such employees exist on production: joined 7-8 June, activation job
    // never ran. The edit dialog resends the stored "Active" on every save, so
    // keying the refusal off active_status alone locked HR out of them entirely.
    const calls = stubEmployee({ id: "emp-12", employment_status: "Active", active_status: 0 });

    await employeeService.updateEmployee(
      "emp-12",
      { employmentStatus: "Active", city: "Noida" } as never,
      "hr-user"
    );

    const update = employeeUpdate(calls);
    expect(update?.sql).toContain("city = ?");
    // and it must not have quietly restored their access
    expect(update?.sql).not.toContain("active_status = 1");
  });

  it("still allows an ordinary save on an active employee — the edit dialog sends the field every time", async () => {
    const calls = stubEmployee({ id: "emp-6", employment_status: "Active", active_status: 1 });

    await employeeService.updateEmployee(
      "emp-6",
      { employmentStatus: "Active", city: "Noida" } as never,
      "hr-user"
    );

    const update = employeeUpdate(calls);
    expect(update?.sql).toContain("city = ?");
    expect(update?.sql).not.toContain("active_status");
  });
});
