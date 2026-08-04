import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Process-level row scoping for finance reads.
 *
 * branch_head and process_manager were just granted P&L access. Neither appears in
 * GLOBAL_FINANCE_ROLES, so branch scoping already confines them to their own branch — but a
 * branch may run several processes, and a process manager must not see another manager's revenue
 * and cost simply because it shares their building.
 *
 * The refusal matters as much as the scoping: asking for someone else's process throws rather
 * than being quietly ignored, because a filter that is silently dropped returns data the caller
 * is not entitled to while looking like a normal answer.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[{ process_id: "proc-own" }], []]);
});

describe("resolveFinanceProcessScope", () => {
  it("pins a process manager to their own process", async () => {
    const { resolveFinanceProcessScope } = await import("../finance-access-scope.js");
    const scope = await resolveFinanceProcessScope({ userId: "u1", primaryRole: "process_manager" });
    expect(scope).toBe("proc-own");
  });

  it("refuses a request for another manager's process", async () => {
    const { resolveFinanceProcessScope } = await import("../finance-access-scope.js");
    await expect(
      resolveFinanceProcessScope({
        userId: "u1", primaryRole: "process_manager", requestedProcessId: "proc-someone-else",
      }),
    ).rejects.toThrow(/only access finance records for your assigned process/i);
  });

  it("allows a process manager to ask for their own process explicitly", async () => {
    const { resolveFinanceProcessScope } = await import("../finance-access-scope.js");
    const scope = await resolveFinanceProcessScope({
      userId: "u1", primaryRole: "process_manager", requestedProcessId: "proc-own",
    });
    expect(scope).toBe("proc-own");
  });

  it("leaves a finance user unrestricted", async () => {
    const { resolveFinanceProcessScope } = await import("../finance-access-scope.js");
    expect(await resolveFinanceProcessScope({ userId: "u2", primaryRole: "finance" })).toBeUndefined();
    expect(
      await resolveFinanceProcessScope({ userId: "u2", primaryRole: "finance", requestedProcessId: "proc-any" }),
      "a global-scope role may narrow to any process it chooses",
    ).toBe("proc-any");
  });

  it("does not confine a branch head to one process", async () => {
    // A branch head owns every process in their branch; branch scoping alone is the right limit.
    const { resolveFinanceProcessScope } = await import("../finance-access-scope.js");
    expect(await resolveFinanceProcessScope({ userId: "u3", primaryRole: "branch_head" })).toBeUndefined();
  });

  it("refuses a process manager whose employee record has no process", async () => {
    // Better to fail loudly than to hand back "undefined" and quietly widen them to every process.
    execute.mockResolvedValue([[], []]);
    const { resolveFinanceProcessScope } = await import("../finance-access-scope.js");
    await expect(
      resolveFinanceProcessScope({ userId: "u4", primaryRole: "process_manager" }),
    ).rejects.toThrow(/not mapped to an active employee process/i);
  });

  it("reads the role from the secondary role list too", async () => {
    // requireRole populates userRoles; a user can hold process_manager there rather than as primary.
    const { resolveFinanceProcessScope } = await import("../finance-access-scope.js");
    const scope = await resolveFinanceProcessScope({
      userId: "u5", primaryRole: "employee", userRoles: ["employee", "process_manager"],
    });
    expect(scope).toBe("proc-own");
  });
});
