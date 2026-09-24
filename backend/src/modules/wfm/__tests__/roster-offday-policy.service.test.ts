import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, writeAuditLog, lob, scopeState } = vi.hoisted(() => ({
  execute: vi.fn(),
  writeAuditLog: vi.fn(async () => undefined),
  lob: { mapped: vi.fn(), active: vi.fn(), process: vi.fn() },
  scopeState: { level: "PROCESS_ALL" as string, branchIds: [] as string[], processIds: ["proc-1"] },
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog }));
vi.mock("../../../shared/dashboardScope.js", () => ({
  DashboardScopeConfigurationError: class extends Error {},
  resolveDashboardScopeForRequest: vi.fn(async () => scopeState),
}));
vi.mock("../../roster/weekoff-policy.service.js", () => ({
  resolveWeekOffScopeDefault: vi.fn(async () => ({ day: 0, source: "process_default" })),
}));
vi.mock("../process-lob-map.service.js", () => {
  class LobServiceError extends Error {
    constructor(public statusCode: number, message: string, public code = "LOB_ERROR") { super(message); }
  }
  return {
    LobServiceError,
    resolveCallerScope: vi.fn(async () => ({ sql: "pm.id IN (?)", params: ["proc-1"] })),
    loadProcessInScope: (...a: any[]) => lob.process(...a),
    loadActiveLob: (...a: any[]) => lob.active(...a),
    isLobMappedToProcess: (...a: any[]) => lob.mapped(...a),
  };
});

import {
  createPolicy, getPolicyDetail, listPolicies, normalizePolicyShape, resolvePolicyForEmployee, setPolicyActive, updatePolicy,
} from "../roster-offday-policy.service.js";
import { LobServiceError } from "../process-lob-map.service.js";

const actor = { id: "u-1", role: "wfm" };
const base = { process_id: "proc-1", lob_id: "lob-1", branch_id: null, off_type: "FIXED_DAY" as const, fixed_weekdays: [0], effective_from: "2026-09-01" };

let overlapRows: any[] = [];
let policyRow: any = null;
let empRow: any = null;
let policyRowsForResolve: any[] = [];

async function code(p: Promise<unknown>) {
  try { await p; return "ok"; } catch (e: any) { return e instanceof LobServiceError ? `${e.statusCode}:${e.code}` : `throw:${e.message}`; }
}

beforeEach(() => {
  execute.mockReset();
  writeAuditLog.mockClear();
  overlapRows = []; policyRow = null; empRow = null; policyRowsForResolve = [];
  scopeState.level = "PROCESS_ALL"; scopeState.branchIds = [];
  lob.process.mockReset().mockResolvedValue({ id: "proc-1", process_name: "P", branch_id: "br-1" });
  lob.active.mockReset().mockResolvedValue({ id: "lob-1", lob_code: "L", lob_name: "L" });
  lob.mapped.mockReset().mockResolvedValue(true);
  execute.mockImplementation(async (sql: string) => {
    const s = sql.replace(/\s+/g, " ");
    if (s.startsWith("SELECT id, effective_from, effective_to FROM roster_offday_policy")) return [overlapRows];
    if (s.includes("FROM roster_offday_policy p JOIN process_master pm") && s.includes("WHERE p.id = ?")) return [policyRow ? [policyRow] : []];
    if (s.includes("FROM employees e JOIN process_master pm")) return [empRow ? [empRow] : []];
    if (s.includes("FROM roster_offday_policy p WHERE p.active_status = 1")) return [policyRowsForResolve];
    if (s.startsWith("SELECT id, branch_name FROM branch_master")) return [[{ id: "br-9", branch_name: "B9" }]];
    if (s.startsWith("SELECT a.id, a.action_type")) return [[{ id: "a1", action_type: "roster_offday_policy.create", actor_user_id: "u-1", metadata_json: "{}", created_at: "2026-09-01" }]];
    if (s.startsWith("SELECT id, email FROM auth_user")) return [[{ id: "u-1", email: "w@x" }]];
    if (s.startsWith("SELECT COUNT(*) AS c")) return [[{ c: 3 }]];
    return [[]];
  });
});

describe("normalizePolicyShape", () => {
  it("accepts 1 or 2 fixed weekdays and stores a sorted CSV", () => {
    expect(normalizePolicyShape({ ...base, fixed_weekdays: [6, 0] }).fixed_weekdays).toBe("0,6");
  });
  it.each([
    [{ fixed_weekdays: [] }, "INVALID_WEEKDAYS"],
    [{ fixed_weekdays: [0, 1, 2] }, "INVALID_WEEKDAYS"],
    [{ fixed_weekdays: [7] }, "INVALID_WEEKDAYS"],
    [{ floating_offs_per_week: 1 }, "INVALID_OFFS_PER_WEEK"],
    [{ effective_from: "2026-02-30" }, "INVALID_DATE"],
    [{ effective_to: "2026-08-31" }, "INVALID_DATE_RANGE"],
    [{ off_type: "WEEKLY" as any }, "INVALID_OFF_TYPE"],
  ])("rejects %j", async (over, expected) => {
    expect(await code(Promise.resolve().then(() => normalizePolicyShape({ ...base, ...over })))).toBe(`400:${expected}`);
  });
  it("floating needs 1-6 offs per week and no fixed weekdays", () => {
    expect(normalizePolicyShape({ off_type: "FLOATING", floating_offs_per_week: 2, effective_from: "2026-09-01" }))
      .toMatchObject({ off_type: "FLOATING", fixed_weekdays: null, floating_offs_per_week: 2 });
    expect(() => normalizePolicyShape({ off_type: "FLOATING", floating_offs_per_week: 0, effective_from: "2026-09-01" })).toThrow();
    expect(() => normalizePolicyShape({ off_type: "FLOATING", floating_offs_per_week: 7, effective_from: "2026-09-01" })).toThrow();
    expect(() => normalizePolicyShape({ off_type: "FLOATING", floating_offs_per_week: 2, fixed_weekdays: [0], effective_from: "2026-09-01" })).toThrow();
  });
});

describe("createPolicy", () => {
  it("inserts, audits, and returns the id", async () => {
    const { id } = await createPolicy(actor, base);
    expect(id).toMatch(/[0-9a-f-]{36}/);
    const insert = execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO roster_offday_policy"))!;
    expect(insert[1].slice(1, 9)).toEqual(["proc-1", "lob-1", null, "FIXED_DAY", "0", null, "2026-09-01", null]);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action_type: "roster_offday_policy.create", module_key: "wfm_offday_policy", entity_id: id }));
  });
  it("rejects a LOB that is not mapped to the process (400 LOB_NOT_MAPPED) before writing", async () => {
    lob.mapped.mockResolvedValue(false);
    expect(await code(createPolicy(actor, base))).toBe("400:LOB_NOT_MAPPED");
    expect(execute.mock.calls.some((c) => String(c[0]).includes("INSERT"))).toBe(false);
  });
  it("does not require a LOB for a process-wide policy", async () => {
    await createPolicy(actor, { ...base, lob_id: null });
    expect(lob.mapped).not.toHaveBeenCalled();
  });
  it("rejects an out-of-scope process (403) without writing", async () => {
    lob.process.mockRejectedValue(new LobServiceError(403, "outside", "PROCESS_OUT_OF_SCOPE"));
    expect(await code(createPolicy(actor, base))).toBe("403:PROCESS_OUT_OF_SCOPE");
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects an overlapping effective range for the same scope (409), incl. open-ended", async () => {
    overlapRows = [{ id: "old", effective_from: "2026-01-01", effective_to: null }];
    expect(await code(createPolicy(actor, base))).toBe("409:POLICY_OVERLAP");
    overlapRows = [{ id: "old", effective_from: "2026-01-01", effective_to: "2026-08-31" }];
    expect(await code(createPolicy(actor, base))).toBe("ok"); // back-to-back is fine
  });
  it("turns a duplicate-key race into 409", async () => {
    execute.mockImplementationOnce(async () => [[]]).mockImplementationOnce(async () => { throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }); });
    expect(await code(createPolicy(actor, { ...base, lob_id: null }))).toBe("409:POLICY_DUPLICATE");
  });
  it("a branch-scoped caller cannot target a branch outside their scope (403)", async () => {
    scopeState.level = "BRANCH_ALL"; scopeState.branchIds = ["br-1"];
    expect(await code(createPolicy(actor, { ...base, branch_id: "br-9" }))).toBe("403:BRANCH_OUT_OF_SCOPE");
    scopeState.branchIds = ["br-9"];
    expect(await code(createPolicy(actor, { ...base, branch_id: "br-9" }))).toBe("ok");
  });
});

describe("update / activate / detail / list", () => {
  const row = { id: "pol-1", process_id: "proc-1", lob_id: "lob-1", branch_id: null, off_type: "FIXED_DAY", fixed_weekdays: "0",
    floating_offs_per_week: null, effective_from: "2026-09-01", effective_to: null, active_status: 1 };

  it("404s for a policy outside scope or missing", async () => {
    expect(await code(getPolicyDetail(actor, "nope"))).toBe("404:NOT_FOUND");
    expect(await code(updatePolicy(actor, "nope", { off_type: "FIXED_DAY", fixed_weekdays: [0], effective_from: "2026-09-01" }))).toBe("404:NOT_FOUND");
  });
  it("update excludes itself from the overlap check, audits before/after", async () => {
    policyRow = row;
    await updatePolicy(actor, "pol-1", { off_type: "FIXED_DAY", fixed_weekdays: [0, 6], effective_from: "2026-09-01" });
    const overlap = execute.mock.calls.find((c) => String(c[0]).includes("SELECT id, effective_from"))!;
    expect(String(overlap[0])).toContain("id <> ?");
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "roster_offday_policy.update",
      metadata: expect.objectContaining({ before: expect.objectContaining({ fixed_weekdays: "0" }), after: expect.objectContaining({ fixed_weekdays: "0,6" }) }),
    }));
  });
  it("re-activating an overlapping policy is refused", async () => {
    policyRow = { ...row, active_status: 0 };
    overlapRows = [{ id: "other", effective_from: "2026-01-01", effective_to: null }];
    expect(await code(setPolicyActive(actor, "pol-1", true))).toBe("409:POLICY_OVERLAP");
  });
  it("deactivate audits and is idempotent", async () => {
    policyRow = row;
    expect(await setPolicyActive(actor, "pol-1", false)).toEqual({ id: "pol-1", changed: true });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action_type: "roster_offday_policy.deactivate" }));
    policyRow = { ...row, active_status: 0 };
    expect(await setPolicyActive(actor, "pol-1", false)).toEqual({ id: "pol-1", changed: false });
  });
  it("detail returns the policy, the audit entries with actor email, and the employee count", async () => {
    policyRow = row;
    const d: any = await getPolicyDetail(actor, "pol-1");
    expect(d.policy.fixed_weekdays).toEqual([0]);
    expect(d.policy.fixed_weekdays_label).toBe("Sunday");
    expect(d.audit[0]).toMatchObject({ actor_email: "w@x" });
    expect(d.employees_in_scope).toBe(3);
  });
  it("list applies the caller scope predicate", async () => {
    await listPolicies(actor, {});
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain("pm.id IN (?)");
    expect(sql).toContain("p.active_status = 1");
  });
});

describe("resolvePolicyForEmployee", () => {
  const emp = { id: "e1", employee_code: "E1", process_id: "proc-1", lob_id: "lob-1", branch_id: "br-1" };
  const pr = (over: any) => ({ id: "x", process_id: "proc-1", lob_id: null, branch_id: null, off_type: "FIXED_DAY", fixed_weekdays: "1",
    floating_offs_per_week: null, effective_from: "2026-01-01", effective_to: null, ...over });

  it("403s (not 500) for an employee outside scope", async () => {
    expect(await code(resolvePolicyForEmployee(actor, "e1", "2026-09-06"))).toBe("403:EMPLOYEE_OUT_OF_SCOPE");
  });
  it("400s on a bad date", async () => {
    expect(await code(resolvePolicyForEmployee(actor, "e1", "06/09/2026"))).toBe("400:INVALID_DATE");
  });
  it("precedence: process+LOB+branch > process+LOB > process+branch > process", async () => {
    empRow = emp;
    policyRowsForResolve = [pr({ id: "p" }), pr({ id: "pb", branch_id: "br-1" }), pr({ id: "pl", lob_id: "lob-1" }), pr({ id: "plb", lob_id: "lob-1", branch_id: "br-1" })];
    expect(await resolvePolicyForEmployee(actor, "e1", "2026-09-06")).toMatchObject({ source: "roster_offday_policy", policy_id: "plb" });
    policyRowsForResolve = policyRowsForResolve.filter((r) => r.id !== "plb");
    expect(await resolvePolicyForEmployee(actor, "e1", "2026-09-06")).toMatchObject({ policy_id: "pl" });
    policyRowsForResolve = policyRowsForResolve.filter((r) => r.id !== "pl");
    expect(await resolvePolicyForEmployee(actor, "e1", "2026-09-06")).toMatchObject({ policy_id: "pb" });
    policyRowsForResolve = policyRowsForResolve.filter((r) => r.id !== "pb");
    expect(await resolvePolicyForEmployee(actor, "e1", "2026-09-06")).toMatchObject({ policy_id: "p", fixed_weekdays: [1] });
  });
  it("falls back to week_off_policy_default, then to none", async () => {
    empRow = emp;
    expect(await resolvePolicyForEmployee(actor, "e1", "2026-09-06")).toMatchObject({ source: "week_off_policy_default", fixed_weekdays: [0], off_type: "FIXED_DAY" });
    const legacy = await import("../../roster/weekoff-policy.service.js");
    (legacy.resolveWeekOffScopeDefault as any).mockResolvedValueOnce(null);
    expect(await resolvePolicyForEmployee(actor, "e1", "2026-09-06")).toMatchObject({ source: "none" });
  });
  it("a policy outside its effective dates does not apply", async () => {
    empRow = emp;
    policyRowsForResolve = [pr({ id: "p", effective_from: "2027-01-01" })];
    expect((await resolvePolicyForEmployee(actor, "e1", "2026-09-06") as any).source).toBe("week_off_policy_default");
  });
});
