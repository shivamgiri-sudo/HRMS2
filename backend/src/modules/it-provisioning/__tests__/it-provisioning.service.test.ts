import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

const mockNotify = vi.fn().mockResolvedValue({ outcome: "shadow" });
vi.mock("../../communication/notification.gateway.js", () => ({
  notificationGateway: { notify: (...args: unknown[]) => mockNotify(...args) },
}));

import { notifyOverdueProvisioning } from "../it-provisioning.service.js";

describe("notifyOverdueProvisioning — 4-hour repeat dedupe key", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockNotify.mockClear();
  });

  it("suffixes the dedupe key with a 4-hour overdue bucket instead of a fixed key", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ floor: null }]]) // backfill floor lookup
      .mockResolvedValueOnce([
        [
          {
            id: "req-1",
            employee_id: "emp-1",
            task_code: "IT_EMAIL_DOMAIN_ASSET",
            assigned_role: "it",
            assigned_user_id: null,
            status: "pending",
            sla_due_at: new Date(),
            hours_overdue: 9, // bucket = floor(9 / 4) = 2
            employee_code: "MAS001",
            branch_id: "branch-1",
            employee_name: "Jane Doe",
            process_name: "Sales",
            reporting_manager_name: "Manager X",
          },
        ],
      ]); // overdue rows

    await notifyOverdueProvisioning();

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "it_provisioning_request:req-1:overdue:2",
      }),
    );
  });

  it("uses bucket 0 for a task less than 4 hours overdue", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ floor: null }]])
      .mockResolvedValueOnce([
        [
          {
            id: "req-2",
            employee_id: "emp-2",
            task_code: "ADMIN_BIOMETRIC_ID_CARD",
            assigned_role: "admin",
            assigned_user_id: null,
            status: "pending",
            sla_due_at: new Date(),
            hours_overdue: 1,
            employee_code: "MAS002",
            branch_id: "branch-1",
            employee_name: "John Roe",
            process_name: "Sales",
            reporting_manager_name: "Manager X",
          },
        ],
      ]);

    await notifyOverdueProvisioning();

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "it_provisioning_request:req-2:overdue:0" }),
    );
  });
});

describe("JOIN_TASKS includes HR_BGV_INITIATION", () => {
  it("dispatches 5 join tasks including the new BGV task, assigned to hr", async () => {
    const mod = await import("../it-provisioning.service.js");
    expect((mod as any).JOIN_TASKS).toBeDefined();
    const bgvTask = (mod as any).JOIN_TASKS.find((t: any) => t.taskCode === "HR_BGV_INITIATION");
    expect(bgvTask).toBeDefined();
    expect(bgvTask.assignedRole).toBe("hr");
  });
});
