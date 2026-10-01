import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exits move through the buckets with no human step. Each stage is its own query, every move goes
 * through exitService.updateExitStatus (so the audit log, row lock and expected-status guard are
 * the same as a person's click) with actor 'system', and one failure never stops the rest.
 */
const { dbExecute, updateExitStatus, policy } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  updateExitStatus: vi.fn(async () => ({})),
  policy: { values: {} as Record<string, string> },
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../lib/logger.js", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("../exit.service.js", () => ({ exitService: { updateExitStatus } }));
vi.mock("../../policy-engine/policy-engine.cache.js", () => ({
  getPolicyValue: vi.fn(async (_d: string, _s: string, key: string, fallback: string) => policy.values[key] ?? fallback),
}));

const { runExitAutoProgress } = await import("../exit-auto-progress.service.js");

let rows: Record<string, any[]>;
beforeEach(() => {
  updateExitStatus.mockReset().mockResolvedValue({});
  dbExecute.mockReset();
  policy.values = {};
  rows = { submitted: [], review: [], accepted: [], due: [], noLwd: [] };
  dbExecute.mockImplementation(async (sql: string) => {
    if (/^\s*UPDATE exit_request/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/status = 'submitted'/.test(sql)) return [rows.submitted, []];
    if (/status = 'manager_review'/.test(sql)) return [rows.review, []];
    if (/status = 'accepted'/.test(sql)) return [rows.accepted, []];
    if (/status = 'notice_serving' AND last_working_day_confirmed IS NULL/.test(sql)) return [rows.noLwd ?? [], []];
    if (/UPDATE exit_request/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/status = 'notice_serving'/.test(sql)) return [rows.due, []];
    return [[], []];
  });
});

describe("runExitAutoProgress", () => {
  it("moves every bucket forward, as 'system', with the expected current status", async () => {
    rows.submitted = [{ id: "s1" }];
    rows.review = [{ id: "r1" }];
    rows.accepted = [{ id: "a1", has_confirmed: 0, proposed: "2026-11-15", notice_period_days: 30 }];
    rows.due = [{ id: "d1" }];
    const res = await runExitAutoProgress();
    expect(res).toMatchObject({ toManagerReview: 1, toAccepted: 1, toNotice: 1, toExited: 1, failed: 0 });
    const calls = updateExitStatus.mock.calls.map((c) => [c[0], c[1], c[3], c[4]]);
    expect(calls).toEqual([
      ["s1", "manager_review", "system", "submitted"],
      ["d1", "exited", "system", "notice_serving"],
      ["r1", "accepted", "system", "manager_review"],
      ["a1", "notice_serving", "system", "accepted"],
    ]);
  });

  it("confirms the employee's proposed last working day only when HR set none", async () => {
    rows.accepted = [
      { id: "none", has_confirmed: 0, proposed: "2026-11-15", notice_period_days: 30 },
      { id: "set", has_confirmed: 1, proposed: "2026-11-20", notice_period_days: 30 },
      { id: "nodays", has_confirmed: 0, proposed: "2026-11-25", notice_period_days: 0 },
    ];
    await runExitAutoProgress();
    const byId = Object.fromEntries(updateExitStatus.mock.calls.map((c) => [c[0], c[5]]));
    // The notice period is always passed on, so the status code writes the notice start/end dates.
    expect(byId.none).toEqual({ lastWorkingDayConfirmed: "2026-11-15", noticePeriodDays: 30 });
    expect(byId.set).toEqual({ noticePeriodDays: 30 });
    expect(byId.nodays).toEqual({ lastWorkingDayConfirmed: "2026-11-25" });
  });

  it("does not guess a date: accepted with no proposed or confirmed LWD is left alone and counted failed", async () => {
    rows.accepted = [{ id: "x", has_confirmed: 0, proposed: null }];
    const res = await runExitAutoProgress();
    expect(updateExitStatus).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });

  it("one failing exit does not stop the others", async () => {
    rows.submitted = [{ id: "bad" }, { id: "good" }];
    updateExitStatus.mockImplementation(async (id: string) => { if (id === "bad") throw new Error("locked"); return {}; });
    const res = await runExitAutoProgress();
    expect(res).toMatchObject({ toManagerReview: 1, failed: 1 });
  });

  it("the master switch stops everything", async () => {
    policy.values.enabled = "0";
    rows.submitted = [{ id: "s1" }];
    const res = await runExitAutoProgress();
    expect(res.skipped).toMatch(/disabled/);
    expect(updateExitStatus).not.toHaveBeenCalled();
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it("each later step has its own switch, and the accept SLA comes from policy", async () => {
    policy.values = { start_notice: "0", exit_at_lwd: "0", accept_after_hours: "6" };
    rows.accepted = [{ id: "a1", has_confirmed: 1, proposed: "2026-11-15" }];
    rows.due = [{ id: "d1" }];
    const res = await runExitAutoProgress();
    expect(res).toMatchObject({ toNotice: 0, toExited: 0 });
    const reviewCall = dbExecute.mock.calls.find((c) => /status = 'manager_review'/.test(String(c[0])));
    expect(reviewCall?.[1]).toEqual([6]);
  });

  it("confirms a missing last working day on a stuck notice_serving resignation and logs it", async () => {
    rows.noLwd = [{ id: "n1" }];
    const res = await runExitAutoProgress();
    expect(res.lwdConfirmed).toBe(1);
    const sqls = dbExecute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((q) => /UPDATE exit_request[\s\S]*last_working_day_confirmed = COALESCE\(last_working_day_proposed/.test(q))).toBe(true);
    expect(sqls.some((q) => /INSERT INTO exit_approval_log[\s\S]*auto_confirm_lwd/.test(q))).toBe(true);
  });

  it("only automates genuine resignations: every selection excludes absconding / termination cases", async () => {
    rows.submitted = [{ id: "s1" }];
    await runExitAutoProgress();
    const selects = dbExecute.mock.calls.map((c) => String(c[0])).filter((q) => /^\s*SELECT/.test(q));
    expect(selects.length).toBeGreaterThanOrEqual(5);
    for (const q of selects) expect(q).toMatch(/exit_sub_type, 'resignation'\) = 'resignation'/);
  });

  it("never moves a backdated exit (LWD before the day it was filed): steps 2-4 all carry the guard", async () => {
    await runExitAutoProgress();
    const selects = dbExecute.mock.calls.map((c) => String(c[0])).filter((q) => /^\s*SELECT/.test(q));
    const guarded = selects.filter((q) => /DATE\(COALESCE\(submitted_at, created_at\)\)/.test(q));
    // accept, start-notice, confirm-LWD and exit selections; the submitted->review one needs none
    expect(guarded.length).toBe(4);
  });

  it("an exit cannot go through several buckets in one run: exits are processed before notice is started", async () => {
    rows.due = [{ id: "old-notice" }];
    rows.accepted = [{ id: "new-accepted", has_confirmed: 0, proposed: "2026-09-14" }];
    await runExitAutoProgress();
    const order = updateExitStatus.mock.calls.map((c) => `${c[0]}:${c[1]}`);
    expect(order).toEqual(["old-notice:exited", "new-accepted:notice_serving"]);
  });
});
