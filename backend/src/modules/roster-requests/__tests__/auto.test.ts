import { describe, expect, it, vi } from "vitest";
import { evaluateAutoApprove, runAutoApprove, maybeAutoApprove, sweepAutoApprove, type AutoDeps } from "../roster-requests.auto.js";
import type { ImpactResult, RequestKind } from "../roster-requests.types.js";

const TODAY = "2026-10-02";

function impact(over: Partial<ImpactResult> = {}): ImpactResult {
  return {
    kind: "swap", id: "x", blockers: [], warnings: [], locked: false, rest: [],
    sameDayHeadcount: { date: "2026-10-05", processName: "P", planned: 10 }, week: [], ...over,
  };
}

function deps(opts: {
  swap?: Record<string, unknown> | null;
  weekoff?: Record<string, unknown> | null;
  rule?: { enabled: boolean; maxCoverageDrop: number; requireCounterpartAccept: boolean };
  impact?: Partial<ImpactResult>;
  decideError?: Error;
  candidates?: { swap: string[]; weekoff: string[] };
  enabledRules?: number;
} = {}): AutoDeps {
  return {
    db: {
      execute: vi.fn(async (sql: string) => {
        if (/COUNT\(\*\)/.test(sql) && /FROM roster_request_auto_rule/.test(sql)) {
          return [[{ n: opts.enabledRules ?? 1 }], []];
        }
        if (/roster_request_auto_rule r/.test(sql) && /wfm_roster_swap_request/.test(sql)) {
          return [(opts.candidates?.swap ?? []).map((id) => ({ id })), []];
        }
        if (/roster_request_auto_rule r/.test(sql) && /wfm_roster_assignment/.test(sql)) {
          return [(opts.candidates?.weekoff ?? []).map((id) => ({ id })), []];
        }
        if (/FROM wfm_roster_swap_request/.test(sql)) {
          return [opts.swap === null ? [] : [{
            status: "pending", counterpart_status: "accepted", requester_emp_id: "e1", d: "2026-10-05",
            process_id: "p1", branch_id: "b1", ...(opts.swap ?? {}),
          }], []];
        }
        if (/FROM wfm_roster_assignment/.test(sql)) {
          return [opts.weekoff === null ? [] : [{
            final_roster_status: "pending_manager_action", employee_id: "e1", d: "2026-10-05",
            process_id: "p1", branch_id: "b1", ...(opts.weekoff ?? {}),
          }], []];
        }
        return [[], []];
      }),
    },
    getAutoRule: vi.fn(async () => opts.rule ?? { enabled: true, maxCoverageDrop: 0, requireCounterpartAccept: true }),
    computeImpact: vi.fn(async (kind: RequestKind, id: string) => impact({ kind, id, ...(opts.impact ?? {}) })),
    decide: vi.fn(async (kind: RequestKind, id: string) => {
      if (opts.decideError) throw opts.decideError;
      return { ok: true as const, kind, id, action: "approve" as const, applied: true };
    }),
    notifyAutoApproved: vi.fn(async () => {}),
    today: () => TODAY,
  };
}

describe("evaluateAutoApprove", () => {
  it("is eligible for a clean, accepted, future swap with an enabled rule", async () => {
    const d = deps();
    expect(await evaluateAutoApprove("swap", "s1", d)).toMatchObject({ eligible: true });
    expect(d.getAutoRule).toHaveBeenCalledWith("p1", "swap");
  });

  it("is eligible for a clean future week-off rejection", async () => {
    expect(await evaluateAutoApprove("weekoff_rejection", "a1", deps())).toMatchObject({ eligible: true });
  });

  it.each(["dispute", "conflict"] as RequestKind[])("never auto-approves a %s", async (kind) => {
    const d = deps();
    const r = await evaluateAutoApprove(kind, "x", d);
    expect(r.eligible).toBe(false);
    expect(d.db.execute).not.toHaveBeenCalled();
  });

  it("is not eligible when the rule is disabled", async () => {
    const r = await evaluateAutoApprove("swap", "s1", deps({ rule: { enabled: false, maxCoverageDrop: 0, requireCounterpartAccept: true } }));
    expect(r).toMatchObject({ eligible: false });
    expect(r.reason).toMatch(/disabled/i);
  });

  it("is not eligible when the request is not found or no longer pending", async () => {
    expect((await evaluateAutoApprove("swap", "s1", deps({ swap: null }))).eligible).toBe(false);
    expect((await evaluateAutoApprove("swap", "s1", deps({ swap: { status: "approved" } }))).eligible).toBe(false);
    expect((await evaluateAutoApprove("weekoff_rejection", "a1", deps({ weekoff: { final_roster_status: "escalated_to_hr" } }))).eligible).toBe(false);
  });

  it("is not eligible when the employee has no process", async () => {
    expect((await evaluateAutoApprove("swap", "s1", deps({ swap: { process_id: null } }))).eligible).toBe(false);
  });

  it.each([TODAY, "2026-10-01"])("is not eligible when the shift date (%s) is not in the future", async (d) => {
    const r = await evaluateAutoApprove("swap", "s1", deps({ swap: { d } }));
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/future/i);
  });

  it("requires counterpart acceptance when the rule says so", async () => {
    const r = await evaluateAutoApprove("swap", "s1", deps({ swap: { counterpart_status: "pending" } }));
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/counterpart/i);
  });

  it("still refuses a pending counterpart when the rule does not require acceptance (the swap service would)", async () => {
    const rule = { enabled: true, maxCoverageDrop: 0, requireCounterpartAccept: false };
    expect((await evaluateAutoApprove("swap", "s1", deps({ rule, swap: { counterpart_status: "pending" } }))).eligible).toBe(false);
    expect((await evaluateAutoApprove("swap", "s1", deps({ rule, swap: { counterpart_status: "declined" } }))).eligible).toBe(false);
  });

  it("allows a swap without counterpart tracking (column absent) only when the rule does not require acceptance", async () => {
    const noCol = { counterpart_status: undefined };
    expect((await evaluateAutoApprove("swap", "s1", deps({ swap: noCol }))).eligible).toBe(false);
    const rule = { enabled: true, maxCoverageDrop: 0, requireCounterpartAccept: false };
    expect((await evaluateAutoApprove("swap", "s1", deps({ rule, swap: noCol }))).eligible).toBe(true);
  });

  it.each([
    [{ blockers: ["Insufficient rest: 300min vs 660min required"] }, /blocker/i],
    [{ warnings: ["No rest policy configured"] }, /warning/i],
    [{ locked: true }, /locked/i],
  ])("is not eligible with impact %o", async (imp, re) => {
    const r = await evaluateAutoApprove("weekoff_rejection", "a1", deps({ impact: imp as any }));
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(re);
  });
});

describe("runAutoApprove", () => {
  it("decides as the auto actor and sends the approver FYI", async () => {
    const d = deps();
    const r = await runAutoApprove("swap", "s1", d);
    expect(r).toMatchObject({ approved: true });
    expect(d.decide).toHaveBeenCalledWith("swap", "s1", { action: "approve", reason: "Auto-approved by rule" }, { userId: null, auto: true });
    expect(d.notifyAutoApproved).toHaveBeenCalledWith(expect.objectContaining({ kind: "swap", sourceId: "s1", employeeId: "e1", date: "2026-10-05" }));
  });

  it("does nothing when not eligible", async () => {
    const d = deps({ rule: { enabled: false, maxCoverageDrop: 0, requireCounterpartAccept: true } });
    expect((await runAutoApprove("swap", "s1", d)).approved).toBe(false);
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.notifyAutoApproved).not.toHaveBeenCalled();
  });

  it("reports (does not throw) when decide refuses, e.g. a race with a manager", async () => {
    const d = deps({ decideError: Object.assign(new Error("already processed"), { statusCode: 409 }) });
    const r = await runAutoApprove("swap", "s1", d);
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/already processed/);
    expect(d.notifyAutoApproved).not.toHaveBeenCalled();
  });
});

describe("maybeAutoApprove", () => {
  it("never throws", async () => {
    const d = deps();
    (d.db.execute as any).mockRejectedValue(new Error("db down"));
    await expect(maybeAutoApprove("swap", "s1", d)).resolves.toMatchObject({ approved: false });
  });
});

describe("sweepAutoApprove", () => {
  it("evaluates every candidate swap and week-off under an enabled rule", async () => {
    const d = deps({ candidates: { swap: ["s1", "s2"], weekoff: ["a1"] } });
    const r = await sweepAutoApprove(d);
    expect(r).toEqual({ checked: 3, approved: 3 });
    const swapQuery = (d.db.execute as any).mock.calls.find((c: any[]) => /roster_request_auto_rule r/.test(c[0]) && /wfm_roster_swap_request/.test(c[0]));
    expect(swapQuery[0]).toMatch(/r\.enabled = 1/);
    expect(swapQuery[1]).toContain(TODAY);
  });

  it("is a cheap no-op when no auto-approve rule is enabled: one COUNT, no candidate scans", async () => {
    const d = deps({ enabledRules: 0, candidates: { swap: ["s1"], weekoff: ["a1"] } });
    const r = await sweepAutoApprove(d);
    expect(r).toEqual({ checked: 0, approved: 0 });
    const calls = (d.db.execute as any).mock.calls as any[][];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatch(/COUNT\(\*\)[\s\S]*FROM roster_request_auto_rule[\s\S]*enabled = 1/);
    expect(d.decide).not.toHaveBeenCalled();
  });
});
