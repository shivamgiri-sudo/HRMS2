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
    expect(def?.defaultAssigneeRoles).toEqual(["hr", "branch_head"]);
    expect(def?.defaultPriority).toBe("high");
    expect(def?.defaultTtlHours).toBeGreaterThanOrEqual(24);
    expect(def?.defaultTtlHours).toBeLessThanOrEqual(48);
    expect(def?.deeplinkPattern).toBe("/employees/{entityId}/360");
    expect(def?.requiresScope).toBe(true);
    expect(ACTION_ITEM_MAP.get("AWOL_SUSPECTED")).toBe(def);
  });

  it("triggerAwolSuspected calls createWorkItemIfNotExists-backed insert with itemType AWOL_SUSPECTED", async () => {
    dbExecute.mockReset();
    dbExecute.mockResolvedValueOnce([[]]); // no existing pending item
    dbExecute.mockResolvedValueOnce([{ insertId: 1 }]); // insert
    await triggerAwolSuspected("emp-1", "Test Employee", "branch-1");
    const insertCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO work_item"));
    expect(insertCall).toBeTruthy();
  });

  it("runAwolDetectionScan runs the query and isolates per-row trigger failures", async () => {
    dbExecute.mockReset();
    // scan query
    dbExecute.mockResolvedValueOnce([[
      { employee_id: "emp-1", employee_code: "MAS1", full_name: "Emp One", branch_id: "b1" },
      { employee_id: "emp-2", employee_code: "MAS2", full_name: "Emp Two", branch_id: "b2" },
    ]]);
    // trigger for emp-1: dedup check + insert
    dbExecute.mockResolvedValueOnce([[]]);
    dbExecute.mockResolvedValueOnce([{ insertId: 1 }]);
    // trigger for emp-2: dedup check throws
    dbExecute.mockRejectedValueOnce(new Error("boom"));

    await expect(runAwolDetectionScan()).resolves.not.toThrow();
    expect(dbExecute).toHaveBeenCalled();
  });

  it("employee-lifecycle worker starts and stops without throwing (module loads cleanly)", () => {
    expect(() => startEmployeeLifecycleWorker()).not.toThrow();
    expect(() => stopEmployeeLifecycleWorker()).not.toThrow();
  });
});
