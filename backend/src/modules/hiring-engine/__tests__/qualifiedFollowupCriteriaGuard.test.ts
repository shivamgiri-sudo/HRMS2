import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// S14: a criteria change stops first contacts for people who no longer qualify (criteria_failed), holds people now in review
// (criteria_review, HR can release), and never touches someone booked for a walk-in. Off by default (SELECTION_FOLLOWUP_GUARD).
const { calls, rows, crit } = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]>, rows: [] as Array<Record<string, unknown>>, crit: [] as Array<Record<string, unknown>> }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const s = sql.replace(/\s+/g, " ").trim();
      calls.push([s, p]);
      if (s.startsWith("SELECT qf.id, qf.mobile10")) return [rows];
      if (s.startsWith("SELECT qf.id, qf.criteria_verdict")) return [crit.filter((c) => (p as string[]).includes(String(c.id)))];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { decideStop } from "../qualified-followup.rules.js";
import { runStopChecks } from "../qualified-followup.stops.js";

const row = (id: string) => ({ id, mobile10: "9876543210", email: "a@b.com", lead_status: "new", consent_revoked: 0, he_replied: 0, meta_replied: 0, ats_stage: null,
  jr_id: "r1", approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 10, fulfilled_headcount: 0 });
const stops = () => calls.filter(([s]) => s.startsWith("UPDATE qualified_followup SET stopped_reason")).map(([, p]) => [p[1], p[0]]);
beforeEach(() => { calls.length = 0; rows.length = 0; crit.length = 0; });
afterEach(() => vi.unstubAllEnvs());

describe("decideStop with a criteria fact", () => {
  const base = { optedOut: false, repliedSinceQualified: false, requisitionClosed: null, joined: false, hasMobile: true, hasEmail: true };
  it("fail -> criteria_failed, review -> criteria_review, booked -> nothing, pass/none -> nothing", () => {
    expect(decideStop({ ...base, criteria: { verdict: "fail", booked: false } })).toBe("criteria_failed");
    expect(decideStop({ ...base, criteria: { verdict: "review", booked: false } })).toBe("criteria_review");
    expect(decideStop({ ...base, criteria: { verdict: "fail", booked: true } })).toBeNull();
    expect(decideStop({ ...base, criteria: { verdict: "pass", booked: false } })).toBeNull();
    expect(decideStop({ ...base, criteria: { verdict: null, booked: false } })).toBeNull();
  });
  it("today's reasons still win (STOP before criteria)", () => {
    expect(decideStop({ ...base, optedOut: true, criteria: { verdict: "fail", booked: false } })).toBe("opted_out");
  });
});

describe("runStopChecks with the guard", () => {
  it("off: no extra statement and no criteria stop (the pin)", async () => {
    rows.push(row("a"));
    crit.push({ id: "a", criteria_verdict: "fail", booked: 0 });
    await runStopChecks("live", 500);
    expect(calls.some(([s]) => s.startsWith("SELECT qf.id, qf.criteria_verdict"))).toBe(false);
    expect(stops()).toEqual([]);
  });
  it("on: one extra read per page; stage A fail stops, review holds, a booked person continues", async () => {
    vi.stubEnv("SELECTION_FOLLOWUP_GUARD", "1");
    rows.push(row("a"), row("b"), row("c"), row("d"));
    crit.push({ id: "a", criteria_verdict: "fail", booked: 0 }, { id: "b", criteria_verdict: "review", booked: 0 }, { id: "c", criteria_verdict: "fail", booked: 1 });
    const out = await runStopChecks("live", 500);
    expect(calls.filter(([s]) => s.startsWith("SELECT qf.id, qf.criteria_verdict"))).toHaveLength(1);
    expect(stops()).toEqual([["a", "criteria_failed"], ["b", "criteria_review"]]);
    expect(out.stopped).toEqual({ criteria_failed: 1, criteria_review: 1 });
    // no recall: the only writes are the stop updates
    expect(calls.filter(([s]) => /^(UPDATE|INSERT|DELETE)/.test(s)).every(([s]) => s.startsWith("UPDATE qualified_followup SET stopped_reason"))).toBe(true);
  });
  it("on, but the criteria read fails (before migration 2145): today's behaviour", async () => {
    vi.stubEnv("SELECTION_FOLLOWUP_GUARD", "1");
    const { db } = await import("../../../db/mysql.js");
    (db.execute as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async (sql: string) => { calls.push([sql, []]); return [[row("a")]]; })
      .mockImplementationOnce(async () => { throw Object.assign(new Error("Unknown column 'criteria_verdict'"), { code: "ER_BAD_FIELD_ERROR" }); });
    await runStopChecks("live", 500);
    expect(stops()).toEqual([]);
  });
});
