import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Auto-routing to a branch/department SPOC (2026-08-24). Before this, createTicket() never
 * set assigned_to — confirmed live, every ticket sat unassigned until a human manually called
 * /assign or /take. resolveAutoAssignee() picks the first active holder of the category's
 * owning role (CATEGORY_OWNER_ROLES) in the raiser's own branch, falling back org-wide, by
 * reusing recipient-resolver.ts's already-proven resolveRoleHolderUserIds() rather than a new
 * query. The existing /assign endpoint is untouched — this only changes what assigned_to
 * starts as, not who can change it afterward.
 */

const { resolveRoleHolderUserIds } = vi.hoisted(() => ({
  resolveRoleHolderUserIds: vi.fn(async () => [] as string[]),
}));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds }));

const mockExecute = vi.fn(async (sql: string) => {
  if (/SELECT branch_id FROM employees/.test(sql)) return [[{ branch_id: "branch-1" }], []];
  if (/^SELECT \* FROM helpdesk_ticket WHERE/.test(sql)) return [[{ id: "t-1", employee_id: "emp-1" }], []];
  return [[], []];
});
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...(args as [string, unknown[]])) },
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../../communication/sms.helper.js", () => ({ sendSMS: vi.fn(async () => undefined) }));

import { helpdeskService, resolveAutoAssignee, CATEGORY_OWNER_ROLES } from "../helpdesk.service.js";

describe("CATEGORY_OWNER_ROLES — the mapping routing and RBAC both derive from", () => {
  it("covers every category the frontend's own filter list offers", () => {
    // Native SupportCommandCenter.tsx's hardcoded category filter list.
    const frontendCategories = ["hr", "payroll", "it", "general", "asset", "attendance", "admin", "leave", "other"];
    for (const c of frontendCategories) {
      expect(CATEGORY_OWNER_ROLES[c]).toBeDefined();
      expect(CATEGORY_OWNER_ROLES[c].length).toBeGreaterThan(0);
    }
  });

  it("routes IT to the IT role family, not admin/hr", () => {
    expect(CATEGORY_OWNER_ROLES.it).toEqual(["it", "branch_it", "it_admin"]);
  });
});

describe("resolveAutoAssignee", () => {
  beforeEach(() => resolveRoleHolderUserIds.mockClear().mockResolvedValue([]));

  it("assigns to the first branch-scoped holder of the category's owning role", async () => {
    resolveRoleHolderUserIds.mockResolvedValueOnce(["user-it-branch-1"]);
    const result = await resolveAutoAssignee("it", "branch-1");
    expect(result).toBe("user-it-branch-1");
    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("it", "branch-1");
  });

  it("tries the next role in the category's owner list when the first has no holder", async () => {
    // it category's owner list is ["it","branch_it","it_admin"] — first two empty, third has someone.
    resolveRoleHolderUserIds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["it-admin-user"]);
    const result = await resolveAutoAssignee("it", "branch-1");
    expect(result).toBe("it-admin-user");
    expect(resolveRoleHolderUserIds).toHaveBeenNthCalledWith(3, "it_admin", "branch-1");
  });

  it("routes hr, leave, and payroll categories all to the hr role", async () => {
    resolveRoleHolderUserIds.mockResolvedValue(["hr-user"]);
    for (const category of ["hr", "leave", "payroll"]) {
      resolveRoleHolderUserIds.mockClear().mockResolvedValueOnce(["hr-user"]);
      await resolveAutoAssignee(category, "branch-1");
      expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("hr", "branch-1");
    }
  });

  it("returns null (stays unassigned) when nobody anywhere holds an owning role — same as today's fallback, not a new failure mode", async () => {
    resolveRoleHolderUserIds.mockResolvedValue([]);
    const result = await resolveAutoAssignee("it", "branch-1");
    expect(result).toBeNull();
  });

  it("falls back to the 'other' mapping for an unrecognized category rather than throwing", async () => {
    resolveRoleHolderUserIds.mockResolvedValueOnce(["admin-user"]);
    const result = await resolveAutoAssignee("totally_unknown_category", "branch-1");
    expect(result).toBe("admin-user");
    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("admin", "branch-1");
  });

  it("is case-insensitive on the category string", async () => {
    resolveRoleHolderUserIds.mockResolvedValueOnce(["it-user"]);
    await resolveAutoAssignee("IT", "branch-1");
    expect(resolveRoleHolderUserIds).toHaveBeenCalledWith("it", "branch-1");
  });
});

describe("createTicket — wires auto-routing into the INSERT", () => {
  beforeEach(() => {
    mockExecute.mockClear();
    resolveRoleHolderUserIds.mockClear();
  });

  it("looks up the raiser's branch, resolves an assignee, and includes it in the INSERT", async () => {
    resolveRoleHolderUserIds.mockResolvedValueOnce(["assignee-1"]);

    await helpdeskService.createTicket({
      employee_id: "emp-1", category: "it", subject: "Laptop won't boot", description: "…",
    });

    const insertCall = mockExecute.mock.calls.find(([sql]) => /INSERT INTO helpdesk_ticket/.test(sql as string));
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall as [string, unknown[]];
    expect(sql).toContain("assigned_to");
    expect(params).toContain("assignee-1");
  });

  it("still creates the ticket, unassigned, if the branch/role lookup throws", async () => {
    resolveRoleHolderUserIds.mockRejectedValueOnce(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(helpdeskService.createTicket({
      employee_id: "emp-1", category: "it", subject: "x", description: "y",
    })).resolves.toBeDefined();

    const insertCall = mockExecute.mock.calls.find(([sql]) => /INSERT INTO helpdesk_ticket/.test(sql as string));
    const [, params] = insertCall as [string, unknown[]];
    expect(params).toContain(null); // assigned_to fell back to null, not a thrown error
    consoleSpy.mockRestore();
  });
});
