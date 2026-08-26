import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The "exit clearance incomplete" control, end to end.
 *
 * Two separate failures met here:
 *
 * 1. notifyLastWorkingDayApproaching had ZERO call sites. Its three siblings are invoked from
 *    the routes that cause them; "the last working day is near" is not caused by a request, so
 *    nothing fired it. The clearance count it carries was computed by nothing.
 *
 * 2. The count itself read `status = 'pending'` against
 *    ENUM('pending','in_progress','cleared','blocked','waived'), so 'blocked' — the single
 *    state most worth alerting on — could never appear in it.
 */

const dbExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }));

const notify = vi.fn().mockResolvedValue({ status: "sent" });
vi.mock("../../communication/notification.gateway.js", () => ({
  notificationGateway: { notify: (...a: unknown[]) => notify(...a) },
}));

const { runLastWorkingDayScan } = await import("../exit-lwd-scan.service.js");

beforeEach(() => { dbExecute.mockReset(); notify.mockClear(); });

describe("last-working-day scan", () => {
  it("selects only dated, non-terminal exits inside the lookahead window", async () => {
    dbExecute.mockResolvedValue([[]]);
    await runLastWorkingDayScan();

    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toContain("last_working_day_confirmed IS NOT NULL");
    // Date arithmetic must stay in SQL — a JS-computed window reads the host clock, which
    // has already produced off-by-one-day bugs on this deployment.
    expect(sql).toContain("CURDATE()");
    expect(sql).toContain("DATE_ADD(CURDATE(), INTERVAL ? DAY)");
    expect(sql).toContain("status NOT IN");
    // An exit already finished, abandoned, or never submitted must not alert.
    for (const s of ["draft", "exited", "revoked", "rejected"]) expect(params).toContain(s);
  });

  it("notifies each exit found, and reports what it did", async () => {
    dbExecute.mockImplementation((sql: string) => {
      if (sql.includes("DATE_ADD(CURDATE()")) return [[{ id: "x-1" }, { id: "x-2" }]];
      if (sql.includes("exit_clearance_task")) return [[{ pending: 2, departments: "it, payroll" }]];
      return [[{ employee_id: "e-1", branch_id: "b-1", process_id: "p-1", employee_name: "A", employee_code: "C1", last_working_day_confirmed: "2026-09-01" }]];
    });

    const r = await runLastWorkingDayScan();
    expect(r).toEqual({ scanned: 2, notified: 2, failed: 0 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][0].eventCode).toBe("exit_lwd_approaching");
  });

  it("carries the open-clearance count into the notification", async () => {
    dbExecute.mockImplementation((sql: string) => {
      if (sql.includes("DATE_ADD(CURDATE()")) return [[{ id: "x-1" }]];
      if (sql.includes("exit_clearance_task")) return [[{ pending: 3, departments: "assets, it, payroll" }]];
      return [[{ employee_id: "e-1", branch_id: "b-1", process_id: "p-1", employee_name: "A", employee_code: "C1", last_working_day_confirmed: "2026-09-01" }]];
    });

    await runLastWorkingDayScan();
    const data = notify.mock.calls[0][0].data;
    expect(data.clearance_pending).toBe(3);
    expect(data.clearance_departments).toBe("assets, it, payroll");
  });

  it("counts blocked and in_progress clearances as open, matching the F&F gate", async () => {
    // The old predicate was `status = 'pending'`. A blocked clearance would have been
    // reported as an all-clear while the F&F approval guard refused to pay.
    //
    // The assertions below MUST stay outside the mock. notifyLastWorkingDayApproaching wraps
    // this very query in a bare `catch {}` ("checklist unreadable — report null"), so an
    // expect() thrown inside the mock is swallowed and the test passes against the broken
    // predicate. That was not hypothetical: this test was written that way first and went
    // green against `status = 'pending'`.
    const seenSql: string[] = [];
    dbExecute.mockImplementation((sql: string) => {
      seenSql.push(sql);
      if (sql.includes("DATE_ADD(CURDATE()")) return [[{ id: "x-1" }]];
      if (sql.includes("exit_clearance_task")) return [[{ pending: 1, departments: "assets" }]];
      return [[{ employee_id: "e-1", branch_id: "b-1", process_id: "p-1", employee_name: "A", employee_code: "C1", last_working_day_confirmed: "2026-09-01" }]];
    });

    await runLastWorkingDayScan();

    const clearanceSql = seenSql.find((s) => s.includes("exit_clearance_task"));
    expect(clearanceSql, "the clearance count query never ran").toBeTruthy();
    expect(clearanceSql).toContain("status NOT IN ('cleared', 'waived')");
    expect(clearanceSql).not.toMatch(/status\s*=\s*'pending'/);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("one unnotifiable exit does not abandon the rest of the batch", async () => {
    let seen = 0;
    dbExecute.mockImplementation((sql: string) => {
      if (sql.includes("DATE_ADD(CURDATE()")) return [[{ id: "x-1" }, { id: "x-2" }]];
      if (sql.includes("exit_clearance_task")) return [[{ pending: 0, departments: null }]];
      seen += 1;
      if (seen === 1) throw new Error("context row unreadable");
      return [[{ employee_id: "e-2", branch_id: "b-1", process_id: "p-1", employee_name: "B", employee_code: "C2", last_working_day_confirmed: "2026-09-01" }]];
    });

    const r = await runLastWorkingDayScan();
    expect(r.scanned).toBe(2);
    // notifyLastWorkingDayApproaching swallows its own errors, so the second still goes out.
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no exit is in the window", async () => {
    dbExecute.mockResolvedValue([[]]);
    const r = await runLastWorkingDayScan();
    expect(r).toEqual({ scanned: 0, notified: 0, failed: 0 });
    expect(notify).not.toHaveBeenCalled();
  });
});
