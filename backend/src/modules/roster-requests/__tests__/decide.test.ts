import { describe, expect, it, vi } from "vitest";
import { ALLOWED_ACTIONS, decideRosterRequest, type DecideDeps } from "../roster-requests.decide.js";
import { SYSTEM_AUTO_APPROVE_ACTOR, type ImpactResult, type RequestKind } from "../roster-requests.types.js";

const actor = { userId: "u-mgr" };

function impact(kind: RequestKind, id: string, blockers: string[] = []): ImpactResult {
  return {
    kind, id, blockers, warnings: [], locked: false, rest: [], sameDayHeadcount: null,
    week: [{ employeeId: "e1", days: [] }],
  };
}

function deps(over: Partial<DecideDeps> = {}, blockers: string[] = []) {
  const tx = { execute: vi.fn(async () => [[], []]) };
  const d: DecideDeps = {
    db: {
      execute: vi.fn(async (sql: string) => {
        if (/FROM wfm_roster_assignment/.test(sql)) {
          return [[{ employee_id: "e1", roster_date: "2026-10-05", final_roster_status: "pending_manager_action" }], []];
        }
        if (/FROM roster_daily_assignment/.test(sql)) {
          return [[{ employee_id: "e1", roster_date: "2026-10-05", acknowledgement_status: "disputed", dispute_resolved_at: null }], []];
        }
        return [{ affectedRows: 1 }, []];
      }),
    },
    computeImpact: vi.fn(async (kind: RequestKind, id: string) => impact(kind, id, blockers)),
    logDecision: vi.fn(async () => {}),
    notifyRosterRequest: vi.fn(async () => {}),
    hasRole: vi.fn(async () => false),
    swapReview: vi.fn(async (_id: string, status: string) => ({ status, applied: status === "approved" })) as any,
    conflictResolve: vi.fn(async () => undefined) as any,
    conflictScope: vi.fn(async () => ({ sql: "1=1", params: [] })),
    weekoff: {
      approve: vi.fn(async (p: any) => { if (p.onTx) await p.onTx(tx); return { message: "ok", finalRosterStatus: "force_approved_by_manager" }; }),
      reject: vi.fn(async (p: any) => { if (p.onTx) await p.onTx(tx); return { message: "ok", finalRosterStatus: "manager_rejected_employee_request" }; }),
      realign: vi.fn(async (p: any) => { if (p.onTx) await p.onTx(tx); return { message: "ok", finalRosterStatus: "realigned_by_manager" }; }),
      escalate: vi.fn(async (p: any) => { if (p.onTx) await p.onTx(tx); return { message: "ok", finalRosterStatus: "escalated_to_hr" }; }),
    },
    resolveDispute: vi.fn(async () => ({ assignmentId: "d1", employeeId: "e1", rosterDate: "2026-10-05", cycleId: "c1", previousShiftTemplateId: "t-old", shiftTemplateId: "t-new", resolution: "x" })) as any,
    ...over,
  };
  return { d, tx };
}

const inboxCloseCall = (d: DecideDeps) =>
  (d.db.execute as any).mock.calls.find((c: any[]) => /UPDATE work_inbox_item/.test(c[0]));

describe("ALLOWED_ACTIONS", () => {
  it("matches the per-kind decision matrix", () => {
    expect(ALLOWED_ACTIONS).toEqual({
      swap: ["approve", "reject"],
      weekoff_rejection: ["approve", "reject", "realign", "escalate"],
      dispute: ["approve", "reject"],
      conflict: ["approve"],
    });
  });
});

describe("decideRosterRequest — validation", () => {
  it("rejects an unknown kind with 400", async () => {
    const { d } = deps();
    await expect(decideRosterRequest("nope" as any, "x", { action: "approve" }, actor, d)).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each([
    ["swap", "realign"],
    ["swap", "escalate"],
    ["dispute", "realign"],
    ["conflict", "reject"],
    ["weekoff_rejection", "bogus"],
  ])("rejects %s/%s with 400 and touches nothing", async (kind, action) => {
    const { d } = deps();
    await expect(decideRosterRequest(kind as RequestKind, "x", { action: action as any, reason: "r" }, actor, d))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(d.computeImpact).not.toHaveBeenCalled();
    expect(d.logDecision).not.toHaveBeenCalled();
  });

  it.each([
    ["swap", "reject"],
    ["weekoff_rejection", "reject"],
    ["weekoff_rejection", "realign"],
    ["weekoff_rejection", "escalate"],
    ["weekoff_rejection", "approve"],
    ["dispute", "approve"],
    ["dispute", "reject"],
    ["conflict", "approve"],
  ])("requires a reason for %s/%s (400)", async (kind, action) => {
    const { d } = deps();
    await expect(decideRosterRequest(kind as RequestKind, "x", { action: action as any, reason: "   " }, actor, d))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(d.computeImpact).not.toHaveBeenCalled();
  });

  it("does not require a reason to approve a swap", async () => {
    const { d } = deps();
    await expect(decideRosterRequest("swap", "s1", { action: "approve" }, actor, d)).resolves.toMatchObject({ ok: true });
  });
});

describe("decideRosterRequest — swap", () => {
  it("approve calls rosterSwapService.review and does not notify again", async () => {
    const { d } = deps();
    const r = await decideRosterRequest("swap", "s1", { action: "approve", restOverrideReason: "ok", forceWithoutCounterpartAcceptance: true }, actor, d);
    // force is dropped: the actor is not admin/hr (hasRole -> false), as in the existing route.
    expect(d.swapReview).toHaveBeenCalledWith("s1", "approved", "u-mgr", undefined, { forceWithoutCounterpartAcceptance: false, restOverrideReason: "ok" });
    expect(d.hasRole).toHaveBeenCalledWith("u-mgr", "admin", "hr");
    expect(d.logDecision).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "swap", sourceId: "s1", action: "approve", actorUserId: "u-mgr", before: expect.objectContaining({ kind: "swap" }), after: { status: "approved", applied: true } }),
      d.db,
    );
    expect(d.notifyRosterRequest).not.toHaveBeenCalled();
    expect(inboxCloseCall(d)?.[1]).toEqual(["roster_request_pending:swap", "s1"]);
    expect(r).toEqual({ ok: true, kind: "swap", id: "s1", action: "approve", applied: true });
  });

  it("passes force through for admin/hr", async () => {
    const { d } = deps({ hasRole: vi.fn(async () => true) });
    await decideRosterRequest("swap", "s1", { action: "approve", forceWithoutCounterpartAcceptance: true }, actor, d);
    expect(d.swapReview).toHaveBeenCalledWith("s1", "approved", "u-mgr", undefined, expect.objectContaining({ forceWithoutCounterpartAcceptance: true }));
  });

  it("reject maps to status rejected", async () => {
    const { d } = deps();
    const r = await decideRosterRequest("swap", "s1", { action: "reject", reason: "no cover" }, actor, d);
    expect(d.swapReview).toHaveBeenCalledWith("s1", "rejected", "u-mgr", undefined, expect.any(Object));
    expect(r.applied).toBe(false);
  });

  it("blocks approve on a blocker with 409, attaching impact, without calling review", async () => {
    const { d } = deps({}, ["Insufficient rest: 300min vs 660min required"]);
    const err: any = await decideRosterRequest("swap", "s1", { action: "approve" }, actor, d).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.impact.blockers).toHaveLength(1);
    expect(d.swapReview).not.toHaveBeenCalled();
    expect(d.logDecision).not.toHaveBeenCalled();
  });

  it("a rest override reason lets a rest blocker through to the swap service's own policy", async () => {
    const { d } = deps({}, ["Insufficient rest: 300min vs 660min required"]);
    await decideRosterRequest("swap", "s1", { action: "approve", restOverrideReason: "client exception" }, actor, d);
    expect(d.swapReview).toHaveBeenCalledWith("s1", "approved", "u-mgr", undefined, expect.objectContaining({ restOverrideReason: "client exception" }));
  });

  it("reject is never blocked", async () => {
    const { d } = deps({}, ["Attendance locked"]);
    await decideRosterRequest("swap", "s1", { action: "reject", reason: "r" }, actor, d);
    expect(d.swapReview).toHaveBeenCalled();
  });

  it("propagates the service's 409 on an already-processed swap", async () => {
    const { d } = deps({ swapReview: vi.fn(async () => { throw Object.assign(new Error("already processed"), { statusCode: 409 }); }) as any });
    await expect(decideRosterRequest("swap", "s1", { action: "reject", reason: "r" }, actor, d)).rejects.toMatchObject({ statusCode: 409 });
    expect(d.logDecision).not.toHaveBeenCalled();
  });
});

describe("decideRosterRequest — weekoff_rejection", () => {
  it.each([
    ["approve", "approve"],
    ["reject", "reject"],
    ["escalate", "escalate"],
  ] as const)("%s calls the week-off service and logs inside its transaction", async (action, fn) => {
    const { d, tx } = deps();
    await decideRosterRequest("weekoff_rejection", "a1", { action, reason: "because" }, actor, d);
    expect(d.weekoff[fn]).toHaveBeenCalledWith(expect.objectContaining({ assignmentId: "a1", userId: "u-mgr", body: { reason: "because" } }));
    expect(d.logDecision).toHaveBeenCalledWith(expect.objectContaining({ kind: "weekoff_rejection", sourceId: "a1", action, reason: "because" }), tx);
  });

  it("realign passes the new date and shift", async () => {
    const { d } = deps();
    await decideRosterRequest("weekoff_rejection", "a1", { action: "realign", reason: "swap day", newDate: "2026-10-07", newShiftTemplateId: "t2" }, actor, d);
    expect(d.weekoff.realign).toHaveBeenCalledWith(expect.objectContaining({
      body: { reason: "swap day", new_roster_date: "2026-10-07", new_shift_template_id: "t2" },
    }));
  });

  it("does not re-notify for approve/reject/realign (the service already does)", async () => {
    const { d } = deps();
    await decideRosterRequest("weekoff_rejection", "a1", { action: "approve", reason: "ok" }, actor, d);
    expect(d.notifyRosterRequest).not.toHaveBeenCalled();
  });

  it("escalate notifies the employee once (the service does not)", async () => {
    const { d } = deps();
    await decideRosterRequest("weekoff_rejection", "a1", { action: "escalate", reason: "hr" }, actor, d);
    expect(d.notifyRosterRequest).toHaveBeenCalledTimes(1);
    expect(d.notifyRosterRequest).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: ["e1"], kind: "weekoff_rejection", sourceId: "a1" }), d.db);
  });

  it("blocks approve/realign on a lock blocker without calling the service", async () => {
    const { d } = deps({}, ["Attendance locked"]);
    for (const action of ["approve", "realign"] as const) {
      const err: any = await decideRosterRequest("weekoff_rejection", "a1", { action, reason: "r" }, actor, d).catch((e) => e);
      expect(err.statusCode).toBe(409);
      expect(err.impact.blockers).toEqual(["Attendance locked"]);
    }
    expect(d.weekoff.approve).not.toHaveBeenCalled();
    expect(d.weekoff.realign).not.toHaveBeenCalled();
  });

  it("a rest override reason does not unblock a week-off", async () => {
    const { d } = deps({}, ["Insufficient rest: 1min vs 660min required"]);
    await expect(decideRosterRequest("weekoff_rejection", "a1", { action: "approve", reason: "r", restOverrideReason: "x" }, actor, d))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("reject and escalate are not blocked", async () => {
    const { d } = deps({}, ["Attendance locked"]);
    await decideRosterRequest("weekoff_rejection", "a1", { action: "reject", reason: "r" }, actor, d);
    await decideRosterRequest("weekoff_rejection", "a1", { action: "escalate", reason: "r" }, actor, d);
    expect(d.weekoff.reject).toHaveBeenCalled();
    expect(d.weekoff.escalate).toHaveBeenCalled();
  });

  it("409s when the assignment is no longer awaiting a manager", async () => {
    const { d } = deps({
      db: { execute: vi.fn(async () => [[{ employee_id: "e1", roster_date: "2026-10-05", final_roster_status: "force_approved_by_manager" }], []]) },
    });
    await expect(decideRosterRequest("weekoff_rejection", "a1", { action: "approve", reason: "r" }, actor, d)).rejects.toMatchObject({ statusCode: 409 });
    expect(d.weekoff.approve).not.toHaveBeenCalled();
  });

  it("404s when the assignment does not exist", async () => {
    const { d } = deps({ db: { execute: vi.fn(async () => [[], []]) } });
    await expect(decideRosterRequest("weekoff_rejection", "a1", { action: "approve", reason: "r" }, actor, d)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("decideRosterRequest — dispute", () => {
  it("approve resolves and applies the new shift", async () => {
    const { d } = deps();
    await decideRosterRequest("dispute", "d1", { action: "approve", reason: "fixed", newShiftTemplateId: "t-new" }, actor, d);
    expect(d.resolveDispute).toHaveBeenCalledWith(expect.objectContaining({ assignmentId: "d1", userId: "u-mgr", resolution: "fixed", newShiftTemplateId: "t-new" }));
    expect(d.logDecision).toHaveBeenCalledWith(expect.objectContaining({ kind: "dispute", sourceId: "d1", action: "approve", after: expect.objectContaining({ shiftTemplateId: "t-new" }) }), d.db);
    expect(d.notifyRosterRequest).not.toHaveBeenCalled();
  });

  it("reject keeps the original shift even if a new one is sent", async () => {
    const { d } = deps();
    await decideRosterRequest("dispute", "d1", { action: "reject", reason: "stays", newShiftTemplateId: "t-new" }, actor, d);
    expect(d.resolveDispute).toHaveBeenCalledWith(expect.objectContaining({ resolution: "stays", newShiftTemplateId: undefined }));
  });

  it("blocks approve on a blocker; reject still goes through", async () => {
    const { d } = deps({}, ["Insufficient rest: 1min vs 660min required"]);
    const err: any = await decideRosterRequest("dispute", "d1", { action: "approve", reason: "r" }, actor, d).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.impact).toBeDefined();
    expect(d.resolveDispute).not.toHaveBeenCalled();
    await decideRosterRequest("dispute", "d1", { action: "reject", reason: "r" }, actor, d);
    expect(d.resolveDispute).toHaveBeenCalledTimes(1);
  });

  it("approve with a new shift computes impact for that candidate shift", async () => {
    const { d } = deps();
    await decideRosterRequest("dispute", "d1", { action: "approve", reason: "fixed", newShiftTemplateId: "t-new" }, actor, d);
    expect(d.computeImpact).toHaveBeenCalledWith("dispute", "d1", { shiftTemplateId: "t-new" });
  });

  it("reject (or approve without a shift) computes impact for the current shift", async () => {
    const { d } = deps();
    await decideRosterRequest("dispute", "d1", { action: "reject", reason: "stays", newShiftTemplateId: "t-new" }, actor, d);
    await decideRosterRequest("dispute", "d1", { action: "approve", reason: "ack" }, actor, d);
    for (const call of (d.computeImpact as any).mock.calls) expect(call).toEqual(["dispute", "d1"]);
  });

  it("a rest-override reason lets a rest blocker through to the dispute service", async () => {
    const { d } = deps({}, ["Insufficient rest: 600min vs 660min required"]);
    await decideRosterRequest("dispute", "d1", { action: "approve", reason: "r", newShiftTemplateId: "t-new", restOverrideReason: "cover" }, actor, d);
    expect(d.resolveDispute).toHaveBeenCalledWith(expect.objectContaining({ restOverrideReason: "cover", newShiftTemplateId: "t-new" }));
  });

  it("logs the bridge outcome (mirrored, rtaResynced, warnings) in the decision's after snapshot", async () => {
    const { d } = deps({
      resolveDispute: vi.fn(async () => ({ assignmentId: "d1", shiftTemplateId: "t-new", mirrored: false, rtaResynced: true, warnings: ["no live roster row to mirror"] })) as any,
    });
    await decideRosterRequest("dispute", "d1", { action: "approve", reason: "fixed", newShiftTemplateId: "t-new" }, actor, d);
    expect(d.logDecision).toHaveBeenCalledWith(expect.objectContaining({
      after: expect.objectContaining({ mirrored: false, rtaResynced: true, warnings: ["no live roster row to mirror"] }),
    }), d.db);
  });

  it("409s on an already-resolved dispute", async () => {
    const { d } = deps({
      db: { execute: vi.fn(async () => [[{ employee_id: "e1", roster_date: "2026-10-05", acknowledgement_status: "acknowledged", dispute_resolved_at: "2026-10-01" }], []]) },
    });
    await expect(decideRosterRequest("dispute", "d1", { action: "reject", reason: "r" }, actor, d)).rejects.toMatchObject({ statusCode: 409 });
    expect(d.resolveDispute).not.toHaveBeenCalled();
  });
});

describe("decideRosterRequest — conflict", () => {
  it("approve resolves with the reason as the resolution action under the caller's scope", async () => {
    const { d } = deps();
    const r = await decideRosterRequest("conflict", "c1", { action: "approve", reason: "Moved to evening shift" }, actor, d);
    expect(d.conflictScope).toHaveBeenCalledWith("u-mgr");
    expect(d.conflictResolve).toHaveBeenCalledWith("c1", "u-mgr", { resolution_action: "Moved to evening shift", resolution_remarks: null, scope: { sql: "1=1", params: [] } }, undefined);
    expect(d.logDecision).toHaveBeenCalledWith(expect.objectContaining({ kind: "conflict", sourceId: "c1", reason: "Moved to evening shift" }), d.db);
    expect(d.notifyRosterRequest).not.toHaveBeenCalled();
    expect(r.applied).toBe(true);
  });

  it("blocks approve on a blocker without calling resolve", async () => {
    const { d } = deps({}, ["Insufficient rest: 1min vs 660min required"]);
    const err: any = await decideRosterRequest("conflict", "c1", { action: "approve", reason: "x" }, actor, d).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.impact.kind).toBe("conflict");
    expect(d.conflictResolve).not.toHaveBeenCalled();
  });
});

describe("decideRosterRequest — side effects are non-fatal after commit", () => {
  it("an inbox-close failure does not fail the decision", async () => {
    const { d } = deps();
    (d.db.execute as any).mockImplementation(async (sql: string) => {
      if (/UPDATE work_inbox_item/.test(sql)) throw new Error("boom");
      return [[], []];
    });
    await expect(decideRosterRequest("swap", "s1", { action: "approve" }, actor, d)).resolves.toMatchObject({ ok: true });
  });
});

describe("decideRosterRequest — auto-approve actor", () => {
  const auto = { userId: null, auto: true };

  it("swap: passes the system actor to the service and logs actor null with auto=1", async () => {
    const { d } = deps();
    await decideRosterRequest("swap", "s1", { action: "approve", reason: "Auto-approved by rule" }, auto, d);
    expect((d.swapReview as any).mock.calls[0][2]).toBe(SYSTEM_AUTO_APPROVE_ACTOR);
    expect(d.hasRole).not.toHaveBeenCalled();
    expect((d.logDecision as any).mock.calls[0][0]).toMatchObject({ actorUserId: null, auto: true, action: "approve" });
    expect(inboxCloseCall(d)[1]).toEqual(["roster_request_pending:swap", "s1"]);
  });

  it("week-off: runs the service as the system actor with the scope check skipped, log inside the tx", async () => {
    const { d, tx } = deps();
    await decideRosterRequest("weekoff_rejection", "a1", { action: "approve", reason: "Auto-approved by rule" }, auto, d);
    const p = (d.weekoff.approve as any).mock.calls[0][0];
    expect(p.userId).toBe(SYSTEM_AUTO_APPROVE_ACTOR);
    expect(p.systemActor).toBe(true);
    expect((d.logDecision as any).mock.calls[0][0]).toMatchObject({ actorUserId: null, auto: true });
    expect((d.logDecision as any).mock.calls[0][1]).toBe(tx);
  });

  it.each([
    ["dispute", "approve"],
    ["conflict", "approve"],
    ["swap", "reject"],
    ["weekoff_rejection", "escalate"],
  ])("refuses an auto %s/%s decision", async (kind, action) => {
    const { d } = deps();
    await expect(decideRosterRequest(kind as RequestKind, "x", { action: action as any, reason: "r" }, auto, d))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(d.logDecision).not.toHaveBeenCalled();
  });

  it("refuses a non-auto decision without a user", async () => {
    const { d } = deps();
    await expect(decideRosterRequest("swap", "s1", { action: "approve" }, { userId: null }, d))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("a normal manager decision never sets systemActor", async () => {
    const { d } = deps();
    await decideRosterRequest("weekoff_rejection", "a1", { action: "approve", reason: "ok" }, actor, d);
    const p = (d.weekoff.approve as any).mock.calls[0][0];
    expect(p.systemActor).toBeUndefined();
    expect(p.userId).toBe("u-mgr");
    expect((d.logDecision as any).mock.calls[0][0]).toMatchObject({ actorUserId: "u-mgr" });
    expect((d.logDecision as any).mock.calls[0][0].auto).toBeFalsy();
  });
});
