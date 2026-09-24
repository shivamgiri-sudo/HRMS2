import { describe, it, expect, vi, beforeEach } from "vitest";

const { poolExecute, connExecute, lobMapped } = vi.hoisted(() => ({
  poolExecute: vi.fn(), connExecute: vi.fn(), lobMapped: vi.fn(),
}));

const conn = {
  execute: connExecute,
  beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
};
vi.mock("../../../db/mysql.js", () => ({ db: { execute: poolExecute, getConnection: vi.fn(async () => conn) } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../employees/employee-activation.service.js", () => ({ activateIfJoiningDateReached: vi.fn() }));
vi.mock("../../communication/email.service.js", () => ({ emailService: {} }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: {} }));
vi.mock("../../management/manager-attribution.service.js", () => ({ recordSupervisoryChange: vi.fn() }));
vi.mock("../../wfm/process-lob-map.service.js", () => ({ isLobMappedToProcess: lobMapped }));

import { completeWfmAlignmentTask } from "../task-completion-handlers.service.js";

const base = { process_id: "p1", roster_effective_date: "2026-09-25", attendance_effective_date: "2026-09-25" };
const employeeUpdates = () => connExecute.mock.calls.filter(([sql]) => /UPDATE employees SET lob_id/.test(String(sql)));

beforeEach(() => {
  poolExecute.mockReset();
  connExecute.mockReset();
  lobMapped.mockReset();
  Object.values(conn).forEach((f) => typeof f === "function" && (f as any).mockClear?.());
  poolExecute.mockResolvedValue([[{ id: "t1", employee_id: "e1", task_code: "WFM_PROCESS_ALIGNMENT", assigned_role: "wfm", status: "pending", date_of_joining: null }]]);
  connExecute.mockResolvedValue([[]]);
});

describe("completeWfmAlignmentTask LOB handling", () => {
  it("completes without any LOB write when no lob_id is sent (zero-mapped process is not blocked)", async () => {
    await completeWfmAlignmentTask("t1", base, "u1");
    expect(lobMapped).not.toHaveBeenCalled();
    expect(employeeUpdates()).toHaveLength(0);
    expect(conn.commit).toHaveBeenCalled();
  });

  it("saves a chosen LOB that is mapped to the process, inside the same transaction", async () => {
    lobMapped.mockResolvedValue(true);
    await completeWfmAlignmentTask("t1", { ...base, lob_id: "l1" }, "u1");
    expect(lobMapped).toHaveBeenCalledWith(conn, "p1", "l1");
    expect(employeeUpdates()).toHaveLength(1);
    expect(employeeUpdates()[0][1]).toEqual(["l1", "e1"]);
    expect(conn.commit).toHaveBeenCalled();
  });

  it("rejects a LOB not mapped to the process and rolls back (task stays open)", async () => {
    lobMapped.mockResolvedValue(false);
    await expect(completeWfmAlignmentTask("t1", { ...base, lob_id: "l9" }, "u1")).rejects.toMatchObject({ statusCode: 400 });
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(employeeUpdates()).toHaveLength(0);
  });
});
