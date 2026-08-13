import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Round 2 (2026-08-13), P1 gap closure: the minimum-rest policy resolver
 * has been fully wired for a while, but nothing could ever create a
 * wfm_rest_policy row except direct SQL. These tests cover the new admin
 * CRUD: validation (scope_type/scope_id consistency, minute bounds, date
 * ordering), scope_id existence checking, the duplicate-window 409 mapping,
 * update's immutable-scope contract, and deactivate's soft-delete-only
 * posture.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../src/db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));
vi.mock("../src/shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));

import { restPolicyConfigService } from "../src/modules/wfm/rest-policy-config.service.js";

const POLICY_ROW = {
  id: "policy-1", scope_type: "process", scope_id: "proc-1", minimum_rest_minutes: 480,
  allows_emergency_override: 1, effective_from: "2026-08-01", effective_to: null,
  active_status: 1, reason: "standard rest", created_by: "user-1", approved_by: "user-1",
  created_at: "2026-08-01 00:00:00", updated_at: "2026-08-01 00:00:00",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("restPolicyConfigService.create — validation", () => {
  it("rejects an unknown scope_type", async () => {
    await expect(
      restPolicyConfigService.create({ scope_type: "planet" as any, minimum_rest_minutes: 480, effective_from: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects scope_id supplied for scope_type=organization", async () => {
    await expect(
      restPolicyConfigService.create({ scope_type: "organization", scope_id: "should-not-be-here", minimum_rest_minutes: 480, effective_from: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("requires scope_id for a non-organization scope", async () => {
    await expect(
      restPolicyConfigService.create({ scope_type: "process", minimum_rest_minutes: 480, effective_from: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a non-positive minimum_rest_minutes", async () => {
    await expect(
      restPolicyConfigService.create({ scope_type: "organization", minimum_rest_minutes: 0, effective_from: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects minimum_rest_minutes above 24 hours", async () => {
    await expect(
      restPolicyConfigService.create({ scope_type: "organization", minimum_rest_minutes: 1441, effective_from: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a malformed effective_from", async () => {
    await expect(
      restPolicyConfigService.create({ scope_type: "organization", minimum_rest_minutes: 480, effective_from: "08-01-2026" }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects effective_to before effective_from", async () => {
    await expect(
      restPolicyConfigService.create({ scope_type: "organization", minimum_rest_minutes: 480, effective_from: "2026-08-10", effective_to: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a scope_id that doesn't exist in the corresponding table", async () => {
    execute.mockResolvedValueOnce([[], []]); // scope existence check: not found
    await expect(
      restPolicyConfigService.create({ scope_type: "process", scope_id: "nonexistent", minimum_rest_minutes: 480, effective_from: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("maps a duplicate-window insert to 409, not a raw DB error", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT 1 FROM process_master/i.test(text)) return [[{ 1: 1 }], []];
      if (/INSERT INTO wfm_rest_policy/i.test(text)) {
        throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      }
      return [[], []];
    });
    await expect(
      restPolicyConfigService.create({ scope_type: "process", scope_id: "proc-1", minimum_rest_minutes: 480, effective_from: "2026-08-01" }, "u1")
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("succeeds for a valid organization-scope policy with no scope_id", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/INSERT INTO wfm_rest_policy/i.test(text)) return [{ affectedRows: 1 }, []];
      if (/SELECT \* FROM wfm_rest_policy WHERE id/i.test(text)) return [[POLICY_ROW], []];
      return [[], []];
    });
    const result = await restPolicyConfigService.create(
      { scope_type: "organization", minimum_rest_minutes: 600, effective_from: "2026-08-01" }, "u1"
    );
    expect(result).toEqual(POLICY_ROW);
  });
});

describe("restPolicyConfigService.update — scope is immutable", () => {
  it("does not accept scope_type/scope_id in its input type — TS enforces this; behaviorally, only listed fields are ever written", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT \* FROM wfm_rest_policy WHERE id/i.test(text)) return [[POLICY_ROW], []];
      if (/UPDATE wfm_rest_policy SET/i.test(text)) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
    await restPolicyConfigService.update("policy-1", { minimum_rest_minutes: 600 }, "u1");
    const updateCall = execute.mock.calls.find(([sql]) => /UPDATE wfm_rest_policy SET/i.test(String(sql)));
    expect(updateCall![0]).not.toMatch(/scope_type|scope_id/);
  });

  it("rejects an invalid minimum_rest_minutes on update", async () => {
    execute.mockResolvedValue([[POLICY_ROW], []]);
    await expect(restPolicyConfigService.update("policy-1", { minimum_rest_minutes: -5 }, "u1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects effective_to before the existing effective_from", async () => {
    execute.mockResolvedValue([[POLICY_ROW], []]); // effective_from = 2026-08-01
    await expect(restPolicyConfigService.update("policy-1", { effective_to: "2026-01-01" }, "u1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("404s when the policy doesn't exist", async () => {
    execute.mockResolvedValue([[], []]);
    await expect(restPolicyConfigService.update("missing", { minimum_rest_minutes: 500 }, "u1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("restPolicyConfigService.deactivate — soft delete only", () => {
  it("sets active_status=0, never deletes the row", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT \* FROM wfm_rest_policy WHERE id/i.test(text)) return [[POLICY_ROW], []];
      if (/UPDATE wfm_rest_policy SET active_status = 0/i.test(text)) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
    await restPolicyConfigService.deactivate("policy-1", "u1");
    expect(execute.mock.calls.some(([sql]) => /DELETE/i.test(String(sql)))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => /UPDATE wfm_rest_policy SET active_status = 0/i.test(String(sql)))).toBe(true);
  });

  it("409s deactivating an already-inactive policy (no matching row to affect)", async () => {
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (/SELECT \* FROM wfm_rest_policy WHERE id/i.test(text)) return [[{ ...POLICY_ROW, active_status: 0 }], []];
      if (/UPDATE wfm_rest_policy SET active_status = 0/i.test(text)) return [{ affectedRows: 0 }, []];
      return [[], []];
    });
    await expect(restPolicyConfigService.deactivate("policy-1", "u1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("404s deactivating a policy that doesn't exist at all", async () => {
    execute.mockResolvedValue([[], []]);
    await expect(restPolicyConfigService.deactivate("missing", "u1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("restPolicyConfigService.list", () => {
  it("filters by scope_type and active_status when supplied", async () => {
    execute.mockResolvedValue([[POLICY_ROW], []]);
    await restPolicyConfigService.list({ scope_type: "process", active_status: "1" });
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/scope_type = \?/);
    expect(sql).toMatch(/active_status = \?/);
    expect(params).toEqual(["process", 1]);
  });

  it("lists everything with no filters", async () => {
    execute.mockResolvedValue([[POLICY_ROW], []]);
    await restPolicyConfigService.list({});
    const [sql, params] = execute.mock.calls[0];
    expect(sql).not.toMatch(/WHERE/);
    expect(params).toEqual([]);
  });
});
