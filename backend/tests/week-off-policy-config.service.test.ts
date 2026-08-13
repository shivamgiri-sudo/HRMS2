import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Round 2 (2026-08-13), P1 gap closure: week_off_policy_default (tier 3-5
 * of Part A.1's week-off hierarchy) was deliberately seeded empty and had
 * no route to populate it except direct SQL. Mirrors
 * rest-policy-config.service.test.ts's coverage: scope/day validation,
 * scope-target existence checks, the exact-duplicate 409, update's
 * immutable-scope contract, and deactivate's soft-delete-only posture.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../src/db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));
vi.mock("../src/shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));

import { weekOffPolicyConfigService } from "../src/modules/roster/week-off-policy-config.service.js";

const POLICY_ROW = {
  id: "wopd-1", scope_type: "process", process_id: "proc-1", branch_id: null,
  default_week_off_day: 0, effective_from: "2026-08-01", effective_to: null,
  active_status: 1, change_reason: "standard", created_by: "user-1",
  created_at: "2026-08-01 00:00:00", updated_by: null, updated_at: "2026-08-01 00:00:00",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("weekOffPolicyConfigService.create — validation", () => {
  it("rejects an unknown scope_type", async () => {
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "planet" as any, default_week_off_day: 0 }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects process_id/branch_id supplied for scope_type=global", async () => {
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "global", process_id: "proc-1", default_week_off_day: 0 }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires process_id for scope_type=process", async () => {
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "process", default_week_off_day: 0 }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires branch_id for scope_type=branch", async () => {
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "branch", default_week_off_day: 0 }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a default_week_off_day outside 0-6", async () => {
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "global", default_week_off_day: 7 }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "global", default_week_off_day: -1 }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a non-integer default_week_off_day", async () => {
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "global", default_week_off_day: 2.5 }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects effective_to before effective_from", async () => {
    await expect(
      weekOffPolicyConfigService.create(
        { scope_type: "global", default_week_off_day: 0, effective_from: "2026-08-10", effective_to: "2026-08-01" }, "u1"
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a process_id that doesn't exist in process_master", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "process", process_id: "nonexistent", default_week_off_day: 0 }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("409s on an exact scope+effective_from duplicate", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT 1 FROM process_master/i.test(text)) return [[{ 1: 1 }], []];
      if (/SELECT id FROM week_off_policy_default/i.test(text)) return [[{ id: "existing" }], []];
      return [[], []];
    });
    await expect(
      weekOffPolicyConfigService.create({ scope_type: "process", process_id: "proc-1", default_week_off_day: 0, effective_from: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("succeeds for a valid global-scope policy with no process_id/branch_id", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT id FROM week_off_policy_default/i.test(text)) return [[], []]; // no duplicate
      if (/INSERT INTO week_off_policy_default/i.test(text)) return [{ affectedRows: 1 }, []];
      if (/SELECT \* FROM week_off_policy_default WHERE id/i.test(text)) return [[{ ...POLICY_ROW, scope_type: "global", process_id: null }], []];
      return [[], []];
    });
    const result = await weekOffPolicyConfigService.create({ scope_type: "global", default_week_off_day: 0 }, "u1");
    expect(result.scope_type).toBe("global");
  });
});

describe("weekOffPolicyConfigService.update — scope is immutable", () => {
  it("never writes scope_type/process_id/branch_id in the UPDATE statement", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT \* FROM week_off_policy_default WHERE id/i.test(text)) return [[POLICY_ROW], []];
      if (/UPDATE week_off_policy_default SET/i.test(text)) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
    await weekOffPolicyConfigService.update("wopd-1", { default_week_off_day: 3 }, "u1");
    const updateCall = execute.mock.calls.find(([sql]) => /UPDATE week_off_policy_default SET/i.test(String(sql)));
    expect(updateCall![0]).not.toMatch(/scope_type|process_id|branch_id/);
  });

  it("rejects an out-of-range default_week_off_day on update", async () => {
    execute.mockResolvedValue([[POLICY_ROW], []]);
    await expect(weekOffPolicyConfigService.update("wopd-1", { default_week_off_day: 9 }, "u1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("404s when the policy doesn't exist", async () => {
    execute.mockResolvedValue([[], []]);
    await expect(weekOffPolicyConfigService.update("missing", { default_week_off_day: 1 }, "u1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("weekOffPolicyConfigService.deactivate — soft delete only", () => {
  it("sets active_status=0, never deletes the row", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT \* FROM week_off_policy_default WHERE id/i.test(text)) return [[POLICY_ROW], []];
      if (/UPDATE week_off_policy_default SET active_status = 0/i.test(text)) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
    await weekOffPolicyConfigService.deactivate("wopd-1", "u1");
    expect(execute.mock.calls.some(([sql]) => /DELETE/i.test(String(sql)))).toBe(false);
  });

  it("409s deactivating an already-inactive policy", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT \* FROM week_off_policy_default WHERE id/i.test(text)) return [[{ ...POLICY_ROW, active_status: 0 }], []];
      if (/UPDATE week_off_policy_default SET active_status = 0/i.test(text)) return [{ affectedRows: 0 }, []];
      return [[], []];
    });
    await expect(weekOffPolicyConfigService.deactivate("wopd-1", "u1")).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("weekOffPolicyConfigService.list", () => {
  it("filters by scope_type and active_status when supplied", async () => {
    execute.mockResolvedValue([[POLICY_ROW], []]);
    await weekOffPolicyConfigService.list({ scope_type: "process", active_status: "1" });
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/scope_type = \?/);
    expect(sql).toMatch(/active_status = \?/);
    expect(params).toEqual(["process", 1]);
  });
});
