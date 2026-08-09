import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Maker-checker on cost-centre L1 approval.
 *
 * CC_CREATE_ROLES and CC_L1_APPROVAL_ROLES are the identical set
 * (super_admin, admin, finance_head, accounts_head), so without this rule one person can
 * raise a cost centre, submit it, and approve it at L1 — which is exactly what an L1 stage
 * exists to prevent. L2 is narrower and would still catch it before 'active', except for an
 * admin or super_admin, who could walk all three stages alone.
 *
 * These assertions drive the service through its real code path with `db` stubbed, so they
 * fail if the guard is removed rather than merely restating it.
 */
const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (...args: unknown[]) => execute(...args),
    query: (...args: unknown[]) => execute(...args),
    getConnection: vi.fn(),
  },
}));

const CC_ID = "cc-1";
const CREATOR = "user-creator";
const SUBMITTER = "user-submitter";
const APPROVER = "user-approver";

function rowInPendingL1(over: Record<string, unknown> = {}) {
  return {
    id: CC_ID,
    status: "pending_l1",
    created_by: CREATOR,
    submitted_by: SUBMITTER,
    ...over,
  };
}

async function service() {
  return (await import("../cost-centre-management.service.js")).costCentreManagementService;
}

beforeEach(() => {
  execute.mockReset();
  vi.resetModules();
});

describe("cost centre L1 approval — maker-checker", () => {
  it("refuses when the approver raised the cost centre", async () => {
    execute.mockResolvedValue([[rowInPendingL1()], []]);
    const svc = await service();
    await expect(
      svc.approveL1(CC_ID, { id: CREATOR, role: "finance_head" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses when the approver submitted it", async () => {
    execute.mockResolvedValue([[rowInPendingL1()], []]);
    const svc = await service();
    await expect(
      svc.approveL1(CC_ID, { id: SUBMITTER, role: "accounts_head" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses an admin who raised it — privilege does not exempt the rule", async () => {
    // The admin path is the one that matters: L2 is admin/super_admin only, so an admin
    // who could also self-approve L1 would clear every stage alone.
    execute.mockResolvedValue([[rowInPendingL1()], []]);
    const svc = await service();
    await expect(
      svc.approveL1(CC_ID, { id: CREATOR, role: "admin" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows a different person to approve", async () => {
    execute.mockResolvedValue([[rowInPendingL1()], []]);
    const svc = await service();
    await expect(
      svc.approveL1(CC_ID, { id: APPROVER, role: "finance_head" }),
    ).resolves.toBeDefined();
  });

  it("does not block legacy rows, where created_by and submitted_by are NULL", async () => {
    // All 927 production rows carry created_by NULL, so the guard has to stay inert for
    // them rather than refusing every historical cost centre.
    execute.mockResolvedValue([[rowInPendingL1({ created_by: null, submitted_by: null })], []]);
    const svc = await service();
    await expect(
      svc.approveL1(CC_ID, { id: APPROVER, role: "finance_head" }),
    ).resolves.toBeDefined();
  });

  it("still rejects a wrong-status transition before considering identity", async () => {
    execute.mockResolvedValue([[rowInPendingL1({ status: "draft" })], []]);
    const svc = await service();
    await expect(
      svc.approveL1(CC_ID, { id: CREATOR, role: "admin" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
