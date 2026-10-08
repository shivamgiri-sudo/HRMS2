import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Criteria hook item 4: the row's criteria verdict reaches the guard chain only with SELECTION_FOLLOWUP_GUARD on; released = pass. */
const h = vi.hoisted(() => ({ sqls: [] as string[], verdict: null as string | null, fail: false }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push(q);
      if (q.startsWith("SELECT criteria_verdict FROM qualified_followup")) {
        if (h.fail) throw new Error("Unknown column 'criteria_verdict'");
        return [[{ criteria_verdict: h.verdict }]];
      }
      if (q.includes("FROM job_requisition")) return [[{ approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, requisition_validity: null }]];
      return [[]];
    }),
  },
}));
vi.mock("../he-campaign-config.service.js", () => ({ channelAllowed: vi.fn(async () => true) }));

import { loadGuardFacts } from "../followup-guard-facts.service.js";
import { checkFollowupGuards } from "../followup-guards.js";
import type { FollowupRow } from "../qualified-followup.context.js";

const row = { id: "F1", mobile10: "9876543210", requisitionId: "R1", heLeadId: null, matchId: null } as unknown as FollowupRow;
const input = { row, step: "email" as const, now: new Date("2026-10-09T05:00:00Z"), transactional: false, firstContact: true, cadenceStep: true,
  killSwitch: false, sourcePaused: false, waBudgetLeft: 10, branchCapLeft: null, uploadWaAllowed: false };

beforeEach(() => { h.sqls = []; h.verdict = null; h.fail = false; delete process.env.SELECTION_FOLLOWUP_GUARD; });
afterEach(() => { delete process.env.SELECTION_FOLLOWUP_GUARD; });

describe("criteria verdict in the guard facts", () => {
  it("switch off: no read, no verdict (today's statements)", async () => {
    h.verdict = "fail";
    const f = await loadGuardFacts(input);
    expect(f.criteriaVerdict ?? null).toBeNull();
    expect(h.sqls.some((q) => q.includes("criteria_verdict"))).toBe(false);
  });
  it.each([["fail", "fail"], ["review", "review"], ["pass", "pass"], ["released", "pass"], [null, null]])("switch on: stored %s reads as %s", async (stored, seen) => {
    process.env.SELECTION_FOLLOWUP_GUARD = "1";
    h.verdict = stored;
    const f = await loadGuardFacts(input);
    expect(f.criteriaVerdict ?? null).toBe(seen);
  });
  it("switch on: a fail ends a stage A journey; a review holds it", async () => {
    process.env.SELECTION_FOLLOWUP_GUARD = "1";
    h.verdict = "fail";
    expect(checkFollowupGuards(await loadGuardFacts(input))).toMatchObject({ ok: false, reason: "criteria_failed", kind: "end_journey" });
    h.verdict = "review";
    expect(checkFollowupGuards(await loadGuardFacts(input))).toMatchObject({ ok: false, reason: "criteria_review", kind: "hold" });
  });
  it("switch on: a failed read means no verdict (today's behaviour)", async () => {
    process.env.SELECTION_FOLLOWUP_GUARD = "1";
    h.fail = true;
    expect((await loadGuardFacts(input)).criteriaVerdict ?? null).toBeNull();
  });
});
