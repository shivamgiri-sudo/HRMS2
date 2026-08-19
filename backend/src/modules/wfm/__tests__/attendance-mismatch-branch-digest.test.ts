import { describe, it, expect, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import { ACTION_ITEM_MAP, resolveActionItemDef } from "../../work-inbox/action-item-registry.js";
import { triggerAttendanceMismatchBranchBacklog } from "../../work-inbox/work-inbox.triggers.js";
import { runAttendanceMismatchBranchDigest } from "../attendance-mismatch-branch-digest.service.js";

describe("ATTENDANCE_MISMATCH branch digest wiring smoke test", () => {
  it("registers ATTENDANCE_MISMATCH pointing at the branch-scoped attendance-exceptions page", () => {
    const def = resolveActionItemDef("ATTENDANCE_MISMATCH");
    expect(def).toBeTruthy();
    expect(def?.module).toBe("WFM");
    // entityId is a branch_master id, not an individual attendance_record — the registry's
    // entityType was corrected to match what triggerAttendanceMismatchBranchBacklog passes.
    expect(def?.entityType).toBe("branch");
    expect(def?.defaultAssigneeRoles).toContain("wfm");
    expect(def?.defaultPriority).toBe("medium");
    expect(def?.requiresScope).toBe(true);
    // Must NOT be the old /wfm/mismatch-queue pattern, which resolves individual
    // attendance_daily_record rows and cannot be addressed by a branch id.
    expect(def?.deeplinkPattern).toBe("/wfm/attendance-exceptions?branchId={entityId}&status=open");
    expect(ACTION_ITEM_MAP.get("ATTENDANCE_MISMATCH")).toBe(def);
  });

  it("triggerAttendanceMismatchBranchBacklog calls createWorkItemIfNotExists-backed insert with itemType ATTENDANCE_MISMATCH", async () => {
    dbExecute.mockReset();
    dbExecute.mockResolvedValueOnce([[]]); // no existing pending item
    dbExecute.mockResolvedValueOnce([{ insertId: 1 }]); // insert
    await triggerAttendanceMismatchBranchBacklog("branch-1", "NOIDA", 12);
    const insertCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO work_item"));
    expect(insertCall).toBeTruthy();
    // title carries the count so a viewer sees scale without opening the item
    expect(String(insertCall?.[1]?.[2])).toContain("12 employees in NOIDA");
  });

  it("triggerAttendanceMismatchBranchBacklog dedups: a second call while the item is still pending is a no-op insert", async () => {
    dbExecute.mockReset();
    dbExecute.mockResolvedValueOnce([[{ id: "existing-item-id" }]]); // already-pending item found
    await triggerAttendanceMismatchBranchBacklog("branch-1", "NOIDA", 40);
    const insertCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO work_item"));
    expect(insertCall).toBeUndefined();
  });

  it("runAttendanceMismatchBranchDigest runs the per-branch scan and isolates per-row trigger failures", async () => {
    dbExecute.mockReset();
    // scan query: one row per branch with a nonzero open backlog
    dbExecute.mockResolvedValueOnce([[
      { branch_id: "branch-1", branch_name: "NOIDA", employee_count: 444 },
      { branch_id: "branch-2", branch_name: "AHMEDABAD-JALDARSHAN", employee_count: 288 },
    ]]);
    // trigger for branch-1: dedup check + insert
    dbExecute.mockResolvedValueOnce([[]]);
    dbExecute.mockResolvedValueOnce([{ insertId: 1 }]);
    // trigger for branch-2: dedup check throws
    dbExecute.mockRejectedValueOnce(new Error("boom"));

    await expect(runAttendanceMismatchBranchDigest()).resolves.not.toThrow();
    expect(dbExecute).toHaveBeenCalled();

    const scanSql = String(dbExecute.mock.calls[0][0]);
    expect(scanSql).toContain("attendance_reconciliation_issue");
    expect(scanSql).toContain("resolved_at IS NULL");
    expect(scanSql).toContain("GROUP BY e.branch_id");
    // No severity/count threshold anywhere in the scan — every branch with a nonzero
    // backlog is included, aggregation alone is what caps volume.
    expect(scanSql).not.toMatch(/HAVING/i);
  });
});
