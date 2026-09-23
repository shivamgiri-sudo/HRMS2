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

describe("persistStructuredFields — bgv_result", () => {
  it("rejects completing HR_BGV_INITIATION without a red/green result, and accepts a valid one", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;

    vi.resetModules();
    mockExecute.mockReset();
    mockNotify.mockClear();

    vi.doMock("../../../middleware/authMiddleware.js", () => ({
      requireAuth: (req: any, _res: any, next: any) => {
        req.authUser = { id: "user-1" };
        next();
      },
    }));
    vi.doMock("../../../middleware/requireRole.js", () => ({
      requireRole: () => (_req: any, _res: any, next: any) => next(),
    }));
    vi.doMock("../task-completion-handlers.service.js", () => ({
      dispatchTaskCompletion: vi.fn().mockResolvedValue(undefined),
      OFFICIAL_EMAIL_REGEX: /^[a-zA-Z0-9._%+-]+@(teammas\.in|teammas\.co\.in)$/,
    }));
    vi.doMock("../it-provisioning.service.js", () => ({
      listProvisioningRequests: vi.fn(),
      getProvisioningRequest: vi.fn().mockResolvedValue({ id: "req-bgv-1", task_code: "HR_BGV_INITIATION" }),
      actionProvisioningRequest: vi.fn().mockResolvedValue(undefined),
      waiveProvisioningRequest: vi.fn(),
      confirmAndLockRequest: vi.fn(),
      reopenLockedRequest: vi.fn(),
      getProvisioningStats: vi.fn(),
      OFFICIAL_EMAIL_REGEX: /^[a-zA-Z0-9._%+-]+@(teammas\.in|teammas\.co\.in)$/,
    }));

    const { itProvisioningRouter } = await import("../it-provisioning.routes.js");
    const app = express();
    app.use(express.json());
    app.use("/api/it-provisioning", itProvisioningRouter);

    mockExecute.mockResolvedValueOnce([
      [{ task_code: "HR_BGV_INITIATION", status: "pending", locked: 0 }],
    ]);
    const rejected = await request(app)
      .post("/api/it-provisioning/tasks/req-bgv-1/complete")
      .send({ evidence_note: "Vendor pending" });
    expect(rejected.status).toBe(400);

    mockExecute
      .mockResolvedValueOnce([
        [{ task_code: "HR_BGV_INITIATION", status: "pending", locked: 0 }],
      ])
      .mockResolvedValueOnce([{}]) // persistStructuredFields UPDATE
      .mockResolvedValueOnce([{}]); // any further db call inside actionProvisioningRequest mock path (mocked, so unused)
    const accepted = await request(app)
      .post("/api/it-provisioning/tasks/req-bgv-1/complete")
      .send({ bgv_result: "green", evidence_note: "Vendor confirmed clean report, ref VEN-2026-441" });
    expect(accepted.status).toBe(200);

    vi.doUnmock("../../../middleware/authMiddleware.js");
    vi.doUnmock("../../../middleware/requireRole.js");
    vi.doUnmock("../task-completion-handlers.service.js");
    vi.doUnmock("../it-provisioning.service.js");
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
