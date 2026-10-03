/**
 * DPDP withdrawal workflow hardening: input rules, state guards, executable tasks, task ownership,
 * requester notifications and SLA escalation. The database is mocked at the module boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const svc = await import("../dpdp-withdrawal.service.js");

const ID = "11111111-1111-1111-1111-111111111111";
const HR = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";

const flush = () => new Promise((r) => setImmediate(r));
const sqls = () => execute.mock.calls.map((c) => String(c[0]));
const actions = () =>
  execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO dpdp_withdrawal_audit_log")).map((c) => String((c[1] as unknown[])[1]));
const notified = () =>
  execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO work_item") && (c[1] as unknown[]).includes(USER)).map((c) => String((c[1] as unknown[])[1]));

beforeEach(() => execute.mockReset());

describe("validateSubmission", () => {
  it("accepts a request with no reason (withdrawal must be as easy as giving consent)", () => {
    const r = svc.validateSubmission({});
    expect(r).toEqual({ ok: true, value: { requesterType: "employee", channel: "self", scope: null, reason: "" } });
  });
  it("keeps a reason, trims it, and caps its length", () => {
    expect((svc.validateSubmission({ reason: "  no longer needed " }) as any).value.reason).toBe("no longer needed");
    expect(svc.validateSubmission({ reason: "x".repeat(2001) }).ok).toBe(false);
  });
  it("only accepts known data categories, de-duplicated", () => {
    expect((svc.validateSubmission({ scope_json: ["biometric_data", "biometric_data"] }) as any).value.scope).toEqual(["biometric_data"]);
    expect(svc.validateSubmission({ scope_json: ["biometric_data", "salary_secrets"] }).ok).toBe(false);
    expect(svc.validateSubmission({ scope_json: "all" }).ok).toBe(false);
    expect((svc.validateSubmission({ scope_json: [] }) as any).value.scope).toBeNull();
  });
  it("rejects unknown channel and requester type instead of storing client text", () => {
    expect(svc.validateSubmission({ channel: "carrier-pigeon" }).ok).toBe(false);
    expect(svc.validateSubmission({ requester_type: "admin" }).ok).toBe(false);
    expect(svc.validateSubmission({ channel: "hr_on_behalf", requester_type: "candidate" }).ok).toBe(true);
  });
});

describe("tasksForScope", () => {
  it("creates one task per module for the chosen categories, plus a third-party notice", () => {
    const mods = svc.tasksForScope(["biometric_data", "bgv_data"]).map((t) => t.module);
    expect(mods).toEqual(["biometric", "bgv", "third_parties"]);
  });
  it("no scope means every category, without duplicate modules", () => {
    const mods = svc.tasksForScope(null).map((t) => t.module);
    expect(new Set(mods).size).toBe(mods.length);
    for (const m of ["employee_master", "attendance", "biometric", "payroll", "bgv", "third_parties"]) expect(mods).toContain(m);
  });
});

describe("submitRequest", () => {
  it("refuses a second open request and names the existing reference", async () => {
    execute.mockResolvedValueOnce([[{ id: ID, reference_number: "WDR-AAAA1111" }]]);
    await expect(svc.submitRequest(USER, "employee", null, "", "self")).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("WDR-AAAA1111") });
    expect(sqls().some((q) => q.includes("INSERT INTO dpdp_consent_withdrawal"))).toBe(false);
  });
  it("stores an empty reason as NULL, acknowledges the principal, and returns reference + deadline", async () => {
    execute
      .mockResolvedValueOnce([[]])                              // no open request
      .mockResolvedValueOnce([[{ config_value: "240" }]])       // configured decision SLA (10 days)
      .mockResolvedValue([{}]);
    const out = await svc.submitRequest(USER, "employee", ["biometric_data"], "", "self");
    expect(out.request_ref).toMatch(/^WDR-[0-9A-F]{8}$/);
    const insert = execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO dpdp_consent_withdrawal"))!;
    expect((insert[1] as unknown[])[4]).toBeNull(); // withdrawal_reason
    expect((insert[1] as unknown[])[6]).toBe(240);  // INTERVAL ? HOUR comes from dpdp_config
    expect(actions()).toEqual(expect.arrayContaining(["DPDP_WITHDRAWAL_SUBMITTED", "DPDP_WITHDRAWAL_ACKNOWLEDGED"]));
    expect(notified().some((t) => t.includes(out.request_ref) && t.includes("10 days"))).toBe(true);
  });
});

describe("state guards", () => {
  it("startReview refuses a request that is no longer 'submitted' and writes no hold or audit", async () => {
    execute
      .mockResolvedValueOnce([[{ requester_id: USER }]])   // who
      .mockResolvedValueOnce([[{ ok: 1 }]])                // active employee
      .mockResolvedValueOnce([{ affectedRows: 0 }])        // UPDATE
      .mockResolvedValueOnce([[{ status: "approved" }]]);
    await expect(svc.startReview(ID, HR)).rejects.toMatchObject({ statusCode: 409 });
    expect(sqls().some((q) => q.includes("INSERT INTO dpdp_processing_hold"))).toBe(false);
    expect(actions()).toEqual([]);
  });

  it("startReview places NO blanket hold for a current employee, and says so in the audit", async () => {
    execute
      .mockResolvedValueOnce([[{ requester_id: USER }]])
      .mockResolvedValueOnce([[{ ok: 1 }]])                // active
      .mockResolvedValue([{ affectedRows: 1 }]);
    await svc.startReview(ID, HR);
    expect(sqls().some((q) => q.includes("INSERT INTO dpdp_processing_hold"))).toBe(false);
    const upd = execute.mock.calls.find((c) => String(c[0]).includes("SET status = 'in_review'"))!;
    expect(String(upd[0])).toContain("hold_applied_at = NULL");
    expect((upd[1] as unknown[])[1]).toBe(0);
    expect(actions()).toEqual(["DPDP_WITHDRAWAL_REVIEW_STARTED"]);
  });

  it("startReview applies the hold for a former employee or candidate", async () => {
    execute
      .mockResolvedValueOnce([[{ requester_id: USER }]])
      .mockResolvedValueOnce([[]])                         // not an active employee
      .mockResolvedValue([{ affectedRows: 1 }]);
    await svc.startReview(ID, HR);
    expect(sqls().some((q) => q.includes("INSERT INTO dpdp_processing_hold"))).toBe(true);
    const upd = execute.mock.calls.find((c) => String(c[0]).includes("SET status = 'in_review'"))!;
    expect((upd[1] as unknown[])[1]).toBe(1);
    expect(actions()).toEqual(["DPDP_WITHDRAWAL_REVIEW_STARTED", "DPDP_PROCESSING_HOLD_APPLIED"]);
  });

  it("reject refuses an already-approved request (the old UPDATE flipped it silently)", async () => {
    execute
      .mockResolvedValueOnce([[{ status: "approved", requester_id: USER }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(svc.reject(ID, HR, "no")).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("approved") });
    expect(actions()).toEqual([]);
    expect(notified()).toEqual([]);
  });

  it("reject records the real previous status, closes the request and tells the principal why", async () => {
    execute
      .mockResolvedValueOnce([[{ status: "in_review", requester_id: USER }]])
      .mockResolvedValue([{ affectedRows: 1 }]);
    await svc.reject(ID, HR, "Needed for statutory payroll records");
    const audit = execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO dpdp_withdrawal_audit_log") && (c[1] as unknown[])[1] === "DPDP_WITHDRAWAL_REJECTED")!;
    expect((audit[1] as unknown[])[2]).toBe("in_review");
    expect(sqls().some((q) => q.includes("closed_at = NOW()") && q.includes("status = 'rejected'"))).toBe(true);
    expect(notified()[0]).toContain("Needed for statutory payroll records");
  });
});

describe("approve", () => {
  it("creates the per-module tasks once and notifies the principal", async () => {
    execute
      .mockResolvedValueOnce([[{ status: "in_review" }]])                       // pre status
      .mockResolvedValueOnce([{ affectedRows: 1 }])                              // UPDATE approve
      .mockResolvedValueOnce([{}])                                               // release hold
      .mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]) // 3 audit
      .mockResolvedValueOnce([[{ requester_id: USER, withdrawal_scope_json: JSON.stringify(["biometric_data"]) }]])
      .mockResolvedValueOnce([[{ n: 0 }]])                                       // no tasks yet
      .mockResolvedValue([{}]);
    await svc.approve(ID, HR, "ok");
    await flush();
    const inserted = execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO dpdp_withdrawal_task")).map((c) => (c[1] as unknown[])[1]);
    expect(inserted).toEqual(["biometric", "third_parties"]);
    expect(actions()).toContain("DPDP_WITHDRAWAL_IMPLEMENTATION_STARTED");
    expect(notified()[0]).toContain("approved");
  });

  it("does not create tasks a second time", async () => {
    execute
      .mockResolvedValueOnce([[{ status: "submitted" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ requester_id: USER, withdrawal_scope_json: null }]])
      .mockResolvedValueOnce([[{ n: 4 }]])
      .mockResolvedValue([{}]);
    await svc.approve(ID, HR);
    expect(sqls().some((q) => q.includes("INSERT INTO dpdp_withdrawal_task"))).toBe(false);
  });
});

describe("completeTask", () => {
  it("is scoped to the withdrawal in the URL and reports 'not found' for another request's task", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await svc.completeTask("t1", HR, "n", ID)).toBe(false);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("AND withdrawal_id = ?");
    expect(params).toEqual([HR, "n", "t1", ID]);
    expect(actions()).toEqual([]);
  });

  it("stamps the withdrawal as implemented when the last task closes", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ withdrawal_id: ID, module_key: "payroll" }]])
      .mockResolvedValueOnce([{}])                  // audit
      .mockResolvedValueOnce([[{ n: 0 }]])          // none pending
      .mockResolvedValue([{}]);
    expect(await svc.completeTask("t1", HR, undefined, ID)).toBe(true);
    await flush();
    expect(sqls().some((q) => q.includes("implementation_completed_at = NOW()"))).toBe(true);
    expect(actions()).toContain("DPDP_WITHDRAWAL_IMPLEMENTATION_COMPLETED");
  });

  it("does not stamp it while tasks remain", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ withdrawal_id: ID, module_key: "payroll" }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ n: 2 }]])
      .mockResolvedValue([{}]);
    await svc.completeTask("t1", HR, undefined, ID);
    await flush();
    expect(sqls().some((q) => q.includes("implementation_completed_at = NOW()"))).toBe(false);
  });
});

describe("escalateOverdueWithdrawals", () => {
  it("flags each overdue open request once, audits it and raises a critical item for the DPO", async () => {
    execute
      .mockResolvedValueOnce([[{ id: ID, reference_number: "WDR-AAAA1111" }]])
      .mockResolvedValue([{}]);
    expect(await svc.escalateOverdueWithdrawals()).toBe(1);
    expect(sqls()[0]).toContain("COALESCE(escalation_required, 0) = 0");
    expect(sqls().some((q) => q.includes("SET escalation_required = 1"))).toBe(true);
    expect(actions()).toContain("DPDP_WITHDRAWAL_SLA_ESCALATED");
    const wi = execute.mock.calls.find((c) => String(c[0]).includes("DPDP_WITHDRAWAL_SLA_BREACH"))!;
    expect(String(wi[0])).toContain("'dpo'");
  });
  it("does nothing when nothing is overdue", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await svc.escalateOverdueWithdrawals()).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("separation of duties: nobody decides their own withdrawal", () => {
  const writes = () => sqls().filter((q) => /^\s*(UPDATE|INSERT)/i.test(q));

  it("start-review by the requester is refused (403) and writes nothing", async () => {
    execute.mockResolvedValueOnce([[{ requester_id: USER }]]);
    await expect(svc.startReview(ID, USER)).rejects.toMatchObject({ statusCode: 403, message: svc.OWN_REQUEST_MESSAGE });
    expect(writes()).toEqual([]);
  });
  it("approve by the requester is refused and writes nothing", async () => {
    execute.mockResolvedValueOnce([[{ status: "in_review", requester_id: USER }]]);
    await expect(svc.approve(ID, USER)).rejects.toMatchObject({ statusCode: 403 });
    expect(writes()).toEqual([]);
  });
  it("reject by the requester is refused and writes nothing", async () => {
    execute.mockResolvedValueOnce([[{ status: "in_review", requester_id: USER }]]);
    await expect(svc.reject(ID, USER, "no")).rejects.toMatchObject({ statusCode: 403 });
    expect(writes()).toEqual([]);
  });
  it("manual hold release by the requester is refused and writes nothing", async () => {
    execute.mockResolvedValueOnce([[{ requester_id: USER }]]);
    await expect(svc.releaseHold(ID, USER)).rejects.toMatchObject({ statusCode: 403 });
    expect(writes()).toEqual([]);
  });
  it("a different reviewer is unaffected", () => {
    expect(() => svc.assertNotOwnRequest(USER, HR)).not.toThrow();
    expect(() => svc.assertNotOwnRequest(null, HR)).not.toThrow();
    expect(() => svc.assertNotOwnRequest(USER, USER)).toThrow();
  });
});
