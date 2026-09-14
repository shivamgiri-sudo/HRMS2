import { describe, it, expect, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import { ACTION_ITEM_MAP, resolveActionItemDef } from "../../work-inbox/action-item-registry.js";
import { triggerAwolSuspected } from "../../work-inbox/work-inbox.triggers.js";
import { runAwolDetectionScan } from "../awol-detection.service.js";
import { startEmployeeLifecycleWorker, stopEmployeeLifecycleWorker } from "../../../workers/employee-lifecycle.worker.js";

describe("AWOL detection wiring smoke test", () => {
  it("registers AWOL_SUSPECTED with the expected shape", () => {
    const def = resolveActionItemDef("AWOL_SUSPECTED");
    expect(def).toBeTruthy();
    expect(def?.module).toBe("ATTENDANCE");
    expect(def?.entityType).toBe("employee");
    // Owner ruling 2026-09-12: the reporting manager decides, not hr. "manager" leads the
    // fallback role list — the live item is addressed to the manager's user id and this list
    // only matters when no reporting manager is on file.
    expect(def?.defaultAssigneeRoles).toEqual(["manager", "hr", "branch_head"]);
    expect(def?.defaultPriority).toBe("high");
    expect(def?.defaultTtlHours).toBeGreaterThanOrEqual(24);
    expect(def?.defaultTtlHours).toBeLessThanOrEqual(48);
    expect(def?.deeplinkPattern).toBe("/employees/{entityId}/360");
    expect(def?.requiresScope).toBe(true);
    expect(ACTION_ITEM_MAP.get("AWOL_SUSPECTED")).toBe(def);
  });

  it("registers the Payroll HR counterpart, AWOL_PAYROLL_NOTICE", () => {
    const def = resolveActionItemDef("AWOL_PAYROLL_NOTICE");
    expect(def).toBeTruthy();
    expect(def?.module).toBe("PAYROLL");
    expect(def?.defaultAssigneeRoles).toEqual(["payroll", "payroll_head"]);
  });

  it("triggerAwolSuspected raises BOTH the manager's item and the payroll notice", async () => {
    dbExecute.mockReset();
    dbExecute.mockResolvedValueOnce([[]]); // AWOL_SUSPECTED dedup check
    dbExecute.mockResolvedValueOnce([{ insertId: 1 }]); // AWOL_SUSPECTED insert
    dbExecute.mockResolvedValueOnce([[]]); // AWOL_PAYROLL_NOTICE dedup check
    dbExecute.mockResolvedValueOnce([{ insertId: 2 }]); // AWOL_PAYROLL_NOTICE insert

    await triggerAwolSuspected("emp-1", "Test Employee", "branch-1", {
      reportingManagerUserId: "user-mgr-1",
      lastWorkedDate: "2026-09-01",
      absentDays: 7,
    });

    const inserts = dbExecute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO work_item"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toContain("AWOL_SUSPECTED");
    expect(inserts[0][1]).toContain("user-mgr-1"); // addressed to the manager, not a role
    expect(inserts[1][1]).toContain("AWOL_PAYROLL_NOTICE");
  });

  it("falls back to the manager role when the employee has no reporting manager on file", async () => {
    dbExecute.mockReset();
    dbExecute.mockResolvedValueOnce([[]]);
    dbExecute.mockResolvedValueOnce([{ insertId: 1 }]);
    dbExecute.mockResolvedValueOnce([[]]);
    dbExecute.mockResolvedValueOnce([{ insertId: 2 }]);

    await triggerAwolSuspected("emp-1", "Test Employee", "branch-1", {
      reportingManagerUserId: null,
      lastWorkedDate: null,
    });

    // Must be the INSERT, not the dedup SELECT — the SELECT's own params
    // (entity_type/entity_id/item_type) also happen to contain the string "AWOL_SUSPECTED".
    const suspected = dbExecute.mock.calls.find(
      (c) => String(c[0]).includes("INSERT INTO work_item") && String(c[1]).includes("AWOL_SUSPECTED"),
    );
    expect(suspected?.[1]).toContain("manager"); // role fallback, since no user id was supplied
  });

  it("runAwolDetectionScan runs the query and isolates per-row trigger failures", async () => {
    dbExecute.mockReset();
    // scan query
    dbExecute.mockResolvedValueOnce([[
      { employee_id: "emp-1", employee_code: "MAS1", full_name: "Emp One", branch_id: "b1", reporting_manager_user_id: "user-mgr-1", last_worked_date: "2026-09-01" },
      { employee_id: "emp-2", employee_code: "MAS2", full_name: "Emp Two", branch_id: "b2", reporting_manager_user_id: null, last_worked_date: null },
    ]]);
    // trigger for emp-1: AWOL_SUSPECTED dedup + insert, AWOL_PAYROLL_NOTICE dedup + insert
    dbExecute.mockResolvedValueOnce([[]]);
    dbExecute.mockResolvedValueOnce([{ insertId: 1 }]);
    dbExecute.mockResolvedValueOnce([[]]);
    dbExecute.mockResolvedValueOnce([{ insertId: 2 }]);
    // trigger for emp-2: AWOL_SUSPECTED dedup check throws — must not abort emp-2's own second
    // item or the rest of the scan
    dbExecute.mockRejectedValueOnce(new Error("boom"));

    await expect(runAwolDetectionScan()).resolves.not.toThrow();
    expect(dbExecute).toHaveBeenCalled();
  });

  it("employee-lifecycle worker starts and stops without throwing (module loads cleanly)", () => {
    expect(() => startEmployeeLifecycleWorker()).not.toThrow();
    expect(() => stopEmployeeLifecycleWorker()).not.toThrow();
  });
});
