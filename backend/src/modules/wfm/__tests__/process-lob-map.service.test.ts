import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute, scopeMock, auditMock } = vi.hoisted(() => ({
  execute: vi.fn(),
  scopeMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: auditMock }));
vi.mock("../../../shared/dashboardScope.js", () => {
  class DashboardScopeConfigurationError extends Error {}
  return { DashboardScopeConfigurationError, resolveDashboardScopeForRequest: scopeMock };
});

import {
  LobServiceError,
  addMapping,
  applySingleMappedLob,
  bulkAssignLob,
  createLob,
  deriveLobCode,
  isLobMappedToProcess,
  processScopeSql,
  resolveCallerScope,
  setEmployeeLob,
  setMappingActive,
} from "../process-lob-map.service.js";
import { DashboardScopeConfigurationError } from "../../../shared/dashboardScope.js";

const actor = { id: "u-1", role: "wfm", roles: ["wfm"] };
const ORG = { level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId: "u-1", role: "wfm" };

/** Queue responses in call order: each entry is the rows array of one db.execute call. */
function queue(...responses: any[]) {
  execute.mockReset();
  for (const r of responses) execute.mockResolvedValueOnce([r, undefined]);
  execute.mockResolvedValue([[], undefined]);
}
const sqlOf = (i: number) => String(execute.mock.calls[i][0]);

beforeEach(() => {
  execute.mockReset();
  auditMock.mockReset();
  scopeMock.mockReset();
  scopeMock.mockResolvedValue(ORG);
});

describe("processScopeSql", () => {
  const base = { employeeIds: [], userId: "u", role: "wfm" };
  it("ORG_ALL is unrestricted", () => {
    expect(processScopeSql({ ...base, level: "ORG_ALL", branchIds: [], processIds: [] } as any)).toEqual({ sql: "1=1", params: [] });
  });
  it("BRANCH_ALL filters on pm.branch_id", () => {
    expect(processScopeSql({ ...base, level: "BRANCH_ALL", branchIds: ["b1", "b2"], processIds: [] } as any))
      .toEqual({ sql: "pm.branch_id IN (?,?)", params: ["b1", "b2"] });
  });
  it("PROCESS_ALL filters on pm.id", () => {
    expect(processScopeSql({ ...base, level: "PROCESS_ALL", branchIds: ["b1"], processIds: ["p1"] } as any))
      .toEqual({ sql: "pm.id IN (?)", params: ["p1"] });
  });
  it("CUSTOM_SCOPE ORs branch and process", () => {
    expect(processScopeSql({ ...base, level: "CUSTOM_SCOPE", branchIds: ["b1"], processIds: ["p1"] } as any))
      .toEqual({ sql: "(pm.branch_id IN (?) OR pm.id IN (?))", params: ["b1", "p1"] });
  });
  it("fails closed for empty and self-only scopes", () => {
    expect(processScopeSql({ ...base, level: "BRANCH_ALL", branchIds: [], processIds: [] } as any).sql).toBe("1=0");
    expect(processScopeSql({ ...base, level: "SELF_ONLY", branchIds: [], processIds: [] } as any).sql).toBe("1=0");
    expect(processScopeSql({ ...base, level: "TEAM_ONLY", branchIds: ["b"], processIds: [] } as any).sql).toBe("1=0");
  });
});

describe("resolveCallerScope", () => {
  it("maps a scope-configuration error to 403", async () => {
    scopeMock.mockRejectedValue(new DashboardScopeConfigurationError("no scope"));
    await expect(resolveCallerScope(actor)).rejects.toMatchObject({ statusCode: 403, code: "SCOPE_NOT_CONFIGURED" });
  });
});

describe("deriveLobCode", () => {
  it("uppercases and snake-cases", () => {
    expect(deriveLobCode("  Back Office - Voice! ")).toBe("BACK_OFFICE_VOICE");
  });
});

describe("addMapping", () => {
  it("rejects a process outside the caller's scope with 403 and writes nothing", async () => {
    queue([]); // process lookup empty
    await expect(addMapping(actor, { process_id: "p1", lob_id: "l1" })).rejects.toMatchObject({ statusCode: 403 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("applies the scope predicate in the process lookup", async () => {
    scopeMock.mockResolvedValue({ level: "BRANCH_ALL", branchIds: ["b9"], processIds: [], employeeIds: [], userId: "u-1", role: "wfm" });
    queue([]);
    await expect(addMapping(actor, { process_id: "p1", lob_id: "l1" })).rejects.toBeInstanceOf(LobServiceError);
    expect(sqlOf(0)).toContain("pm.branch_id IN (?)");
    expect(execute.mock.calls[0][1]).toEqual(["p1", "b9"]);
  });

  it("rejects an inactive / unknown LOB with 400", async () => {
    queue([{ id: "p1", process_name: "P", branch_id: "b1" }], []);
    await expect(addMapping(actor, { process_id: "p1", lob_id: "l1" })).rejects.toMatchObject({ statusCode: 400, code: "LOB_INACTIVE" });
  });

  it("rejects a duplicate active mapping with 409", async () => {
    queue(
      [{ id: "p1", process_name: "P", branch_id: "b1" }],
      [{ id: "l1", lob_code: "CHAT", lob_name: "Chat" }],
      [{ id: "m1", active_status: 1 }],
    );
    await expect(addMapping(actor, { process_id: "p1", lob_id: "l1" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("reactivates a soft-deleted mapping instead of inserting", async () => {
    queue(
      [{ id: "p1", process_name: "P", branch_id: "b1" }],
      [{ id: "l1", lob_code: "CHAT", lob_name: "Chat" }],
      [{ id: "m1", active_status: 0 }],
    );
    const res = await addMapping(actor, { process_id: "p1", lob_id: "l1" });
    expect(res).toEqual({ id: "m1", reactivated: true });
    expect(sqlOf(3)).toContain("UPDATE process_lob_map SET active_status = 1");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action_type: "process_lob_map.reactivate", actor_user_id: "u-1" }));
  });

  it("inserts a new mapping with denormalised branch_id and audits it", async () => {
    queue(
      [{ id: "p1", process_name: "P", branch_id: "b1" }],
      [{ id: "l1", lob_code: "CHAT", lob_name: "Chat" }],
      [],
    );
    const res = await addMapping(actor, { process_id: "p1", lob_id: "l1" });
    expect(res.reactivated).toBe(false);
    expect(sqlOf(3)).toContain("INSERT INTO process_lob_map");
    const params = execute.mock.calls[3][1];
    expect(params.slice(1)).toEqual(["p1", "l1", "b1", "u-1", "u-1"]);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action_type: "process_lob_map.add", entity_id: res.id }));
  });

  it("maps a racing duplicate-key error to 409", async () => {
    execute.mockReset();
    execute
      .mockResolvedValueOnce([[{ id: "p1", process_name: "P", branch_id: "b1" }]])
      .mockResolvedValueOnce([[{ id: "l1", lob_code: "CHAT", lob_name: "Chat" }]])
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));
    await expect(addMapping(actor, { process_id: "p1", lob_id: "l1" })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("setMappingActive", () => {
  const mapping = { id: "m1", process_id: "p1", lob_id: "l1", lob_code: "CHAT", active_status: 1 };
  it("deactivates and audits with actor", async () => {
    queue([mapping]);
    const res = await setMappingActive(actor, "m1", false);
    expect(res.changed).toBe(true);
    expect(sqlOf(1)).toContain("UPDATE process_lob_map SET active_status");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action_type: "process_lob_map.deactivate", actor_user_id: "u-1" }));
  });
  it("404s when the mapping is outside scope", async () => {
    queue([]);
    await expect(setMappingActive(actor, "m1", false)).rejects.toMatchObject({ statusCode: 404 });
    expect(auditMock).not.toHaveBeenCalled();
  });
  it("is a no-op when the state already matches", async () => {
    queue([mapping]);
    expect((await setMappingActive(actor, "m1", true)).changed).toBe(false);
    // reactivation path validates the LOB is active; that lookup returned [] here only if called
  });
});

describe("createLob", () => {
  it("auto-derives an uppercase snake code and trims the name", async () => {
    queue([]);
    const res = await createLob(actor, { lob_name: "  Social Media  " });
    expect(res).toMatchObject({ lob_code: "SOCIAL_MEDIA", lob_name: "Social Media" });
    expect(sqlOf(1)).toContain("INSERT INTO lob_master");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action_type: "lob_master.create" }));
  });
  it("rejects a case-insensitive duplicate name with 409", async () => {
    queue([{ id: "x", lob_name: "Chat", lob_code: "CHAT" }]);
    await expect(createLob(actor, { lob_name: "chat" })).rejects.toMatchObject({ statusCode: 409, code: "DUPLICATE_LOB" });
    expect(sqlOf(0)).toContain("UPPER(TRIM(lob_name)) = UPPER(?)");
  });
  it("rejects a malformed explicit code", async () => {
    await expect(createLob(actor, { lob_name: "Chat", lob_code: "a b" })).rejects.toMatchObject({ statusCode: 400 });
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects a name that yields no usable code", async () => {
    await expect(createLob(actor, { lob_name: "!!" })).rejects.toMatchObject({ statusCode: 400, code: "INVALID_CODE" });
  });
});

describe("setEmployeeLob", () => {
  const emp = { id: "e1", employee_code: "E1", full_name: "A", process_id: "p1", lob_id: null };
  it("rejects a LOB not mapped to the employee's process", async () => {
    queue([emp], []);
    await expect(setEmployeeLob(actor, "e1", "l9")).rejects.toMatchObject({ statusCode: 400, code: "LOB_NOT_MAPPED" });
    expect(auditMock).not.toHaveBeenCalled();
  });
  it("writes employees.lob_id for a mapped LOB and audits old/new", async () => {
    queue([emp], [{ ok: 1 }]);
    const res = await setEmployeeLob(actor, "e1", "l1");
    expect(res).toEqual({ employee_id: "e1", lob_id: "l1", changed: true });
    expect(sqlOf(2)).toContain("UPDATE employees SET lob_id");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "employee.lob.set",
      metadata: expect.objectContaining({ old_lob_id: null, new_lob_id: "l1" }),
    }));
  });
  it("allows clearing with null without a mapping check", async () => {
    queue([{ ...emp, lob_id: "l1" }]);
    const res = await setEmployeeLob(actor, "e1", null);
    expect(res.changed).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2); // scope lookup + update
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action_type: "employee.lob.clear" }));
  });
  it("404s for an employee outside scope", async () => {
    queue([]);
    await expect(setEmployeeLob(actor, "e1", "l1")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("applySingleMappedLob (creation-time default)", () => {
  it("stamps the LOB when exactly one active mapping exists, guarded by lob_id IS NULL", async () => {
    queue([{ lob_id: "l1" }]);
    expect(await applySingleMappedLob({ execute }, "e1", "p1")).toBe("l1");
    expect(sqlOf(1)).toContain("lob_id IS NULL");
  });
  it("leaves NULL when the process has no mapped LOB", async () => {
    queue([]);
    expect(await applySingleMappedLob({ execute }, "e1", "p1")).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("leaves NULL when the process has more than one mapped LOB", async () => {
    queue([{ lob_id: "l1" }, { lob_id: "l2" }]);
    expect(await applySingleMappedLob({ execute }, "e1", "p1")).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("does nothing without a process", async () => {
    expect(await applySingleMappedLob({ execute }, "e1", null)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("isLobMappedToProcess", () => {
  it("requires an active mapping and an active LOB", async () => {
    queue([{ ok: 1 }]);
    expect(await isLobMappedToProcess({ execute }, "p1", "l1")).toBe(true);
    expect(sqlOf(0)).toContain("m.active_status = 1 AND l.active_status = 1");
  });
});

describe("bulkAssignLob", () => {
  it("rejects a LOB that is not mapped to the process", async () => {
    queue([{ id: "p1", process_name: "P", branch_id: "b1" }], []);
    await expect(bulkAssignLob(actor, { process_id: "p1", lob_id: "l1" })).rejects.toMatchObject({ statusCode: 400 });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("without employee_ids updates NULL-lob employees of the process and writes ONE audit row", async () => {
    execute.mockReset();
    execute
      .mockResolvedValueOnce([[{ id: "p1", process_name: "P", branch_id: "b1" }]]) // scope
      .mockResolvedValueOnce([[{ ok: 1 }]]) // mapping
      .mockResolvedValueOnce([[{ id: "e1" }, { id: "e2" }, { id: "e3" }]]) // targets
      .mockResolvedValueOnce([{ affectedRows: 3 }]); // update
    const res = await bulkAssignLob(actor, { process_id: "p1", lob_id: "l1" });
    expect(res).toMatchObject({ requested: 3, updated: 3, skipped: 0, remaining: 0 });
    expect(sqlOf(2)).toContain("e.lob_id IS NULL");
    expect(sqlOf(3)).toContain("lob_id IS NULL");
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "employee.lob.bulk_assign",
      metadata: expect.objectContaining({ updated: 3, process_id: "p1", lob_id: "l1" }),
    }));
  });

  it("with employee_ids reports skipped employees that already had a LOB / other process", async () => {
    execute.mockReset();
    execute
      .mockResolvedValueOnce([[{ id: "p1", process_name: "P", branch_id: "b1" }]])
      .mockResolvedValueOnce([[{ ok: 1 }]])
      .mockResolvedValueOnce([[{ id: "e1" }]]) // only e1 qualifies
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await bulkAssignLob(actor, { process_id: "p1", lob_id: "l1", employee_ids: ["e1", "e2"] });
    expect(res).toMatchObject({ requested: 2, updated: 1, skipped: 1 });
  });
});
