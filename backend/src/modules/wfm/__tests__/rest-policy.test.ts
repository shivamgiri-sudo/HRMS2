import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import {
  resolveRestPolicy, restGapMinutes, findAdjacentShifts, validateMinimumRest, logRestOverride,
  isRestPolicyFeatureActive, hasAnyRestPolicyConfigured,
} from "../rest-policy.service.js";
import { __resetSchemaProbeCachesForTests } from "../schema-probe.util.js";

function policyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "policy-1", scope_type: "organization", scope_id: null,
    minimum_rest_minutes: 660, allows_emergency_override: 0,
    ...overrides,
  };
}

beforeEach(() => {
  execute.mockReset();
  __resetSchemaProbeCachesForTests();
});

describe("restGapMinutes", () => {
  it("computes a simple same-day-adjacent gap", () => {
    expect(restGapMinutes({ date: "2026-08-17", time: "18:00" }, { date: "2026-08-18", time: "09:00" })).toBe(15 * 60);
  });

  it("handles a cross-midnight previous shift correctly (not just time-of-day)", () => {
    // Previous shift ends 06:00 on the 18th (an overnight shift), next starts 14:00 same day.
    expect(restGapMinutes({ date: "2026-08-18", time: "06:00" }, { date: "2026-08-18", time: "14:00" })).toBe(8 * 60);
  });

  it("returns a negative number when the next shift starts before the previous one ends (overlap)", () => {
    expect(restGapMinutes({ date: "2026-08-18", time: "10:00" }, { date: "2026-08-18", time: "09:00" })).toBe(-60);
  });

  it("is correct across a month boundary", () => {
    expect(restGapMinutes({ date: "2026-08-31", time: "23:00" }, { date: "2026-09-01", time: "07:00" })).toBe(8 * 60);
  });
});

describe("isRestPolicyFeatureActive", () => {
  it("is false when wfm_rest_policy doesn't exist (migration not applied) -- callers must skip validation, not block", async () => {
    execute.mockResolvedValue([[], []]);
    expect(await isRestPolicyFeatureActive()).toBe(false);
  });

  it("is true once the table exists, regardless of whether any policy row has been configured", async () => {
    execute.mockResolvedValue([[{ TABLE_NAME: "wfm_rest_policy" }], []]);
    expect(await isRestPolicyFeatureActive()).toBe(true);
  });
});

describe("resolveRestPolicy", () => {
  it("returns null (fail closed) when wfm_rest_policy doesn't exist yet (migration not applied)", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[], []]; // table absent
      return [[], []];
    });
    const result = await resolveRestPolicy({ employeeId: "emp-1", forDate: "2026-08-17" });
    expect(result).toBeNull();
  });

  it("returns null (fail closed) when the table exists but no scope has a policy configured", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) return [[], []]; // no row at any scope
      return [[], []];
    });
    const result = await resolveRestPolicy({ employeeId: "emp-1", processId: "proc-1", branchId: "branch-1", forDate: "2026-08-17" });
    expect(result).toBeNull();
  });

  it("prefers an employee-scoped policy over process/branch/organization", async () => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) {
        if (params?.[0] === "employee") {
          return [[policyRow({ id: "policy-emp", scope_type: "employee", scope_id: "emp-1", minimum_rest_minutes: 480 })], []];
        }
        return [[policyRow({ id: "policy-org" })], []]; // would match if employee scope were skipped
      }
      return [[], []];
    });
    const result = await resolveRestPolicy({ employeeId: "emp-1", processId: "proc-1", forDate: "2026-08-17" });
    expect(result?.id).toBe("policy-emp");
    expect(result?.minimumRestMinutes).toBe(480);
  });

  it("falls through employee -> process -> branch -> organization in order when the more specific scopes have nothing", async () => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) {
        if (params?.[0] === "branch") return [[policyRow({ id: "policy-branch", scope_type: "branch", scope_id: "branch-1" })], []];
        return [[], []];
      }
      return [[], []];
    });
    const result = await resolveRestPolicy({ employeeId: "emp-1", processId: "proc-1", branchId: "branch-1", forDate: "2026-08-17" });
    expect(result?.id).toBe("policy-branch");
  });
});

describe("hasAnyRestPolicyConfigured", () => {
  it("is false when nothing resolves at process, branch, or organization scope", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) return [[], []];
      return [[], []];
    });
    expect(await hasAnyRestPolicyConfigured({ processId: "proc-1", branchId: "branch-1", forDate: "2026-08-17" })).toBe(false);
  });

  it("is true when only the organization-wide default resolves", async () => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) {
        if (params?.[0] === "organization") return [[policyRow()], []];
        return [[], []];
      }
      return [[], []];
    });
    expect(await hasAnyRestPolicyConfigured({ processId: "proc-1", branchId: "branch-1", forDate: "2026-08-17" })).toBe(true);
  });
});

describe("findAdjacentShifts", () => {
  it("returns null for both when the employee has no other scheduled shifts", async () => {
    execute.mockResolvedValue([[], []]);
    const result = await findAdjacentShifts("emp-1", "2026-08-17");
    expect(result).toEqual({ previous: null, next: null });
  });

  it("maps the previous and next rows into date/time refs", async () => {
    let call = 0;
    execute.mockImplementation(async () => {
      call += 1;
      if (call === 1) return [[{ roster_date: "2026-08-16", shift_end_time: "18:00:00" }], []];
      return [[{ roster_date: "2026-08-19", shift_start_time: "09:00:00" }], []];
    });
    const result = await findAdjacentShifts("emp-1", "2026-08-17");
    expect(result.previous).toEqual({ date: "2026-08-16", time: "18:00" });
    expect(result.next).toEqual({ date: "2026-08-19", time: "09:00" });
  });
});

describe("validateMinimumRest", () => {
  it("is REST_POLICY_MISSING when no policy resolves, and never proceeds to check the gap", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[], []];
      return [[], []];
    });
    const result = await validateMinimumRest({ employeeId: "emp-1", forDate: "2026-08-17" }, { startTime: "09:00", endTime: "18:00" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("REST_POLICY_MISSING");
    expect(result.policy).toBeNull();
  });

  it("is ok when both neighbors have sufficient rest against the resolved policy", async () => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) return [[policyRow({ minimum_rest_minutes: 600 })], []]; // 10h
      if (sql.includes("roster_date < ?")) return [[{ roster_date: "2026-08-16", shift_end_time: "18:00:00" }], []];
      if (sql.includes("roster_date > ?")) return [[{ roster_date: "2026-08-18", shift_start_time: "09:00:00" }], []];
      return [[], []];
    });
    // Candidate: 09:00-18:00 on 2026-08-17. Prev ends 18:00 on 08-16 -> 15h gap. Next starts 09:00 on 08-18 -> 15h gap.
    const result = await validateMinimumRest({ employeeId: "emp-1", forDate: "2026-08-17" }, { startTime: "09:00", endTime: "18:00" });
    expect(result.ok).toBe(true);
    expect(result.requiredRestMinutes).toBe(600);
  });

  it("is INSUFFICIENT_REST against the previous shift when the gap is below the policy minimum, and reports whether an override is allowed", async () => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) return [[policyRow({ minimum_rest_minutes: 600, allows_emergency_override: 1 })], []];
      // Previous shift ends 22:00 the day before; candidate starts 04:00 -> only 6h gap, below the 10h minimum.
      if (sql.includes("roster_date < ?")) return [[{ roster_date: "2026-08-16", shift_end_time: "22:00:00" }], []];
      if (sql.includes("roster_date > ?")) return [[], []];
      return [[], []];
    });
    const result = await validateMinimumRest({ employeeId: "emp-1", forDate: "2026-08-17" }, { startTime: "04:00", endTime: "13:00" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_REST");
    expect(result.against).toBe("previous");
    expect(result.actualRestMinutes).toBe(6 * 60);
    expect(result.requiredRestMinutes).toBe(600);
    expect(result.canOverride).toBe(true);
  });

  it("reports canOverride: false when the resolved policy does not allow emergency override", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [[{ TABLE_NAME: "wfm_rest_policy" }], []];
      if (sql.includes("FROM wfm_rest_policy")) return [[policyRow({ minimum_rest_minutes: 600, allows_emergency_override: 0 })], []];
      if (sql.includes("roster_date < ?")) return [[{ roster_date: "2026-08-16", shift_end_time: "22:00:00" }], []];
      if (sql.includes("roster_date > ?")) return [[], []];
      return [[], []];
    });
    const result = await validateMinimumRest({ employeeId: "emp-1", forDate: "2026-08-17" }, { startTime: "04:00", endTime: "13:00" });
    expect(result.canOverride).toBe(false);
  });
});

describe("logRestOverride", () => {
  it("inserts a single immutable audit row with all required fields", async () => {
    execute.mockResolvedValue([{ affectedRows: 1 }, []]);
    await logRestOverride({
      employeeId: "emp-1", rosterDate: "2026-08-17",
      previousShiftEndAt: "2026-08-16 22:00:00", nextShiftStartAt: "2026-08-17 04:00:00",
      actualRestMinutes: 360, requiredRestMinutes: 600, policyId: "policy-1",
      source: "manual_assignment", reason: "Urgent coverage gap", requestedBy: "user-1", approvedBy: "manager-1",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO wfm_rest_override_log/);
    expect(params).toContain("Urgent coverage gap");
    expect(params).toContain("manager-1");
  });
});
