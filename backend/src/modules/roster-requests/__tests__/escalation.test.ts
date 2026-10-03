import { describe, expect, it, vi } from "vitest";
import {
  escalationRecipientUserIds,
  runEscalationSweep,
  selectEscalations,
  type EscalationCandidate,
} from "../roster-requests.escalation.js";

const NOW = new Date("2026-10-02T06:00:00Z");

const row = (over: Partial<EscalationCandidate> = {}): EscalationCandidate => ({
  kind: "swap", sourceId: "s1", employeeId: "e1", branchId: "b1", processId: "p1",
  raisedAt: "2026-10-01T06:00:00Z", shiftDate: "2026-10-10", escalated: false, ...over,
});

describe("selectEscalations", () => {
  it("picks overdue (raised > 48h ago) requests", () => {
    const out = selectEscalations([row({ raisedAt: "2026-09-29T00:00:00Z" })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].slaState).toBe("overdue");
  });

  it("picks urgent (shift within 24h) requests even when freshly raised", () => {
    const out = selectEscalations([row({ raisedAt: "2026-10-02T05:00:00Z", shiftDate: "2026-10-03" })], NOW);
    expect(out.map((r) => r.slaState)).toEqual(["urgent"]);
  });

  it("skips ok / due-soon requests", () => {
    expect(selectEscalations([row(), row({ raisedAt: "2026-10-01T00:00:00Z" })], NOW)).toEqual([]);
  });

  it("skips requests already escalated", () => {
    expect(selectEscalations([row({ raisedAt: "2026-09-20T00:00:00Z", escalated: true })], NOW)).toEqual([]);
  });

  it("skips duplicates of the same kind/source", () => {
    const r = row({ raisedAt: "2026-09-20T00:00:00Z" });
    expect(selectEscalations([r, { ...r }], NOW)).toHaveLength(1);
  });
});

function fakeExec(opts: { claimAffected?: number; branchHeads?: string[]; wfm?: string[]; hr?: string[]; candidates?: any[]; disputedAtColumn?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/information_schema\.COLUMNS/i.test(sql)) return [[{ n: opts.disputedAtColumn === false ? 0 : 1 }], []];
    if (/INSERT IGNORE INTO roster_request_escalation/.test(sql)) return [{ affectedRows: opts.claimAffected ?? 1 }, []];
    if (/role_key = 'branch_head'/.test(sql)) return [(opts.branchHeads ?? ["u-bh"]).map((user_id) => ({ user_id })), []];
    if (/role_key = 'hr'/.test(sql)) return [(opts.hr ?? []).map((user_id) => ({ user_id })), []];
    if (/FROM user_roles/.test(sql)) return [(opts.wfm ?? []).map((user_id) => ({ user_id })), []];
    if (/FROM wfm_roster_swap_request/.test(sql)) return [opts.candidates ?? [], []];
    if (/FROM wfm_roster_assignment|FROM roster_daily_assignment|FROM wfm_roster_conflict_log/.test(sql)) return [[], []];
    return [{ affectedRows: 1 }, []];
  });
  return { calls, execute };
}

describe("escalationRecipientUserIds", () => {
  it("returns the branch heads of the branch", async () => {
    const exec = fakeExec({ branchHeads: ["u-bh1", "u-bh2"] });
    expect(await escalationRecipientUserIds("b1", "p1", exec as any)).toEqual(["u-bh1", "u-bh2"]);
  });

  it("falls back to WFM in scope and HR of the branch when there is no branch head", async () => {
    const exec = fakeExec({ branchHeads: [], wfm: ["u-wfm"], hr: ["u-hr", "u-wfm"] });
    expect((await escalationRecipientUserIds("b1", "p1", exec as any)).sort()).toEqual(["u-hr", "u-wfm"]);
  });

  it("goes straight to the fallback when the branch is unknown", async () => {
    const exec = fakeExec({ wfm: ["u-wfm"] });
    expect(await escalationRecipientUserIds(null, "p1", exec as any)).toEqual(["u-wfm"]);
    expect(exec.calls.some((c) => /role_key = 'branch_head'/.test(c.sql))).toBe(false);
  });
});

describe("runEscalationSweep", () => {
  const overdue = {
    kind: "swap", source_id: "s1", employee_id: "e1", branch_id: "b1", process_id: "p1",
    raised_at: "2026-09-25T00:00:00Z", shift_date: "2026-10-10",
  };

  it("claims first and notifies the next level once with a high-priority escalation item", async () => {
    const exec = fakeExec({ candidates: [overdue] });
    const r = await runEscalationSweep(exec as any, NOW);
    expect(r).toEqual({ candidates: 1, escalated: 1 });
    const claimIdx = exec.calls.findIndex((c) => /INSERT IGNORE INTO roster_request_escalation/.test(c.sql));
    const inboxIdx = exec.calls.findIndex((c) => /INSERT INTO work_inbox_item/.test(c.sql));
    expect(claimIdx).toBeGreaterThan(-1);
    expect(inboxIdx).toBeGreaterThan(claimIdx);
    const inbox = exec.calls[inboxIdx];
    expect(inbox.params).toContain("ROSTER_REQUEST_ESCALATED");
    expect(inbox.params).toContain("high");
    expect(inbox.params).toContain("u-bh");
    expect(inbox.params).toContain("roster_request_pending:swap");
    expect(inbox.params).toContain("s1");
  });

  it("does not notify when another run already claimed the escalation", async () => {
    const exec = fakeExec({ candidates: [overdue], claimAffected: 0 });
    const r = await runEscalationSweep(exec as any, NOW);
    expect(r.escalated).toBe(0);
    expect(exec.calls.some((c) => /INSERT INTO work_inbox_item/.test(c.sql))).toBe(false);
  });

  it("excludes already-escalated requests in the query", async () => {
    const exec = fakeExec();
    await runEscalationSweep(exec as any, NOW);
    const loads = exec.calls.filter((c) => /LEFT JOIN roster_request_escalation/.test(c.sql));
    expect(loads).toHaveLength(4);
    for (const l of loads) expect(l.sql).toMatch(/x\.id IS NULL/);
  });

  it("ages a dispute from disputed_at, falling back to updated_at for rows raised before the column", async () => {
    const exec = fakeExec();
    await runEscalationSweep(exec as any, NOW);
    const load = exec.calls.find((c) => /FROM roster_daily_assignment/.test(c.sql))!;
    expect(load.sql).toContain("COALESCE(rda.disputed_at, rda.updated_at) AS raised_at");
    expect(load.sql).toContain("COALESCE(rda.disputed_at, rda.updated_at) < NOW() - INTERVAL 48 HOUR");
  });

  it("uses updated_at alone while the disputed_at column does not exist yet", async () => {
    const exec = fakeExec({ disputedAtColumn: false });
    await runEscalationSweep(exec as any, NOW);
    const load = exec.calls.find((c) => /FROM roster_daily_assignment/.test(c.sql))!;
    expect(load.sql).not.toContain("disputed_at");
    expect(load.sql).toContain("rda.updated_at AS raised_at");
  });

  it("ages a week-off rejection from the employee's response time (employee_ack_at)", async () => {
    const exec = fakeExec();
    await runEscalationSweep(exec as any, NOW);
    const load = exec.calls.find((c) => /FROM wfm_roster_assignment/.test(c.sql))!;
    expect(load.sql).toContain("COALESCE(wra.employee_ack_at, wra.updated_at) AS raised_at");
  });
});
