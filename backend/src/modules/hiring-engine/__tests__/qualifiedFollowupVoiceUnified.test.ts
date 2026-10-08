import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** One call step (Task 10): call result codes, the stamp on a follow-up row (retry, second miss, do-not-call), references. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
  refMatch: null as string | null,
  release: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.startsWith("SELECT") && q.includes("FROM qualified_followup")) return [h.rows];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-call-ref.service.js", () => ({ matchForRef: vi.fn(async () => h.refMatch), refForMatch: vi.fn(async (id: string) => `HRMS-0${id.length}1`) }));
vi.mock("../followup-person.service.js", () => ({ releasePerson: h.release }));

import { callReference, callResultCode, resolveFollowupByReference, stampFollowupCallResult } from "../qualified-followup.callresult.js";
import { planCallFile, type CallFileCandidate } from "../qualified-followup.callfile-plan.js";
import { markFollowupCalled } from "../qualified-followup.attention.js";
import type { FollowupRow } from "../qualified-followup.context.js";

const AT = new Date("2026-10-08T05:30:00Z"); // Thu 11:00 IST
const owned = (o: Record<string, unknown> = {}) => ({ id: "F1", mobile10: "9876543210", call_attempts: 0, journey_state: "reach", ...o });
const updates = () => h.sqls.filter((s) => s.sql.startsWith("UPDATE qualified_followup"));

beforeEach(() => { h.sqls = []; h.rows = []; h.refMatch = null; h.release.mockReset(); process.env.QUAL_FOLLOWUP_MODE = "live"; });
afterEach(() => { delete process.env.QUAL_FOLLOWUP_MODE; });

describe("callResultCode", () => {
  it("maps outcomes", () => {
    expect(callResultCode({ answered: true, identityConfirmed: "yes", originalSlotAnswer: "yes" })).toBe("answered_confirmed");
    expect(callResultCode({ answered: true, identityConfirmed: "yes", originalSlotAnswer: "no", offeredSlotAnswer: "yes" })).toBe("answered_reschedule");
    expect(callResultCode({ answered: true, identityConfirmed: "yes", originalSlotAnswer: "no" })).toBe("answered_declined");
    expect(callResultCode({ answered: true, identityConfirmed: "no" })).toBe("answered_other");
    expect(callResultCode({ answered: false })).toBe("no_answer");
    expect(callResultCode({ answered: false, failedReason: "busy" })).toBe("busy");
    expect(callResultCode({ answered: false, failedReason: "DND" })).toBe("do_not_call");
    expect(callResultCode({ answered: false, failedReason: "do not call me" })).toBe("do_not_call");
    expect(callResultCode({ answered: false, failedReason: "invalid number" })).toBe("failed");
  });
});

describe("stampFollowupCallResult", () => {
  it("result import stamps called and call_result for a follow-up row", async () => {
    h.rows = [owned()];
    expect(await stampFollowupCallResult({ mobile10: "9876543210", reference: null, result: "answered_confirmed", at: AT })).toBe(1);
    const u = updates()[0];
    expect(u.sql).toContain("SET call_state = 'called', call_result = ?, called_at = ?");
    expect(u.p.slice(0, 2)).toEqual(["answered_confirmed", AT]);
    const sel = h.sqls[0];
    expect(sel.sql).toContain("mode_at_enqueue IN ('live','canary','test')");
  });
  it("first no answer re-queues at least 2 h later (in the window)", async () => {
    h.rows = [owned({ call_attempts: 0 })];
    await stampFollowupCallResult({ mobile10: "9876543210", reference: null, result: "no_answer", at: AT });
    const u = updates()[0];
    expect(u.sql).toContain("SET call_state = 'pending', call_result = ?, call_attempts = ?, call_due_at = ?, call_file_batch_id = NULL");
    expect(u.p.slice(0, 3)).toEqual(["no_answer", 1, new Date(AT.getTime() + 120 * 60_000)]);
  });
  it("a miss at 18:30 re-queues to the next morning, not into the night", async () => {
    h.rows = [owned()];
    await stampFollowupCallResult({ mobile10: "9876543210", reference: null, result: "busy", at: new Date("2026-10-08T13:00:00Z") });
    expect(updates()[0].p[2]).toEqual(new Date("2026-10-09T03:30:00Z"));
  });
  it("second miss sets missed_call_due_at (T9 next), the call step is done", async () => {
    h.rows = [owned({ call_attempts: 1 })];
    await stampFollowupCallResult({ mobile10: "9876543210", reference: null, result: "no_answer", at: AT });
    const u = updates()[0];
    expect(u.sql).toContain("SET call_state = 'called', call_result = ?, call_attempts = ?, called_at = ?, missed_call_due_at = ?");
    expect(u.p.slice(0, 4)).toEqual(["no_answer", 2, AT, AT]);
  });
  it("do_not_call stops the journey as opted_out and releases the person", async () => {
    h.rows = [owned()];
    await stampFollowupCallResult({ mobile10: "9876543210", reference: null, result: "do_not_call", at: AT });
    expect(updates()[0].sql).toContain("stopped_reason = 'opted_out'");
    expect(h.release).toHaveBeenCalledWith("9876543210", "F1");
  });
  it("no follow-up row: nothing written", async () => {
    expect(await stampFollowupCallResult({ mobile10: "9876543210", reference: null, result: "no_answer", at: AT })).toBe(0);
    expect(updates()).toHaveLength(0);
  });
  it("mode off: not even a read (prod today)", async () => {
    delete process.env.QUAL_FOLLOWUP_MODE;
    expect(await stampFollowupCallResult({ mobile10: "9876543210", reference: null, result: "no_answer", at: AT })).toBe(0);
    expect(h.sqls).toHaveLength(0);
  });
  it("markFollowupCalled with a result delegates to the stamp; without one the operator path is unchanged", async () => {
    h.rows = [owned()];
    await markFollowupCalled("9876543210", undefined, { result: "answered_other", reference: null, at: AT });
    expect(updates()[0].p[0]).toBe("answered_other");
  });
});

describe("references", () => {
  it("HRMS match reference resolves through the match; QF- reference of an old row resolves by its id prefix", async () => {
    h.refMatch = "M1"; h.rows = [{ id: "F1", match_id: "M1" }];
    expect(await resolveFollowupByReference("HRMS-041")).toEqual({ followupId: "F1", matchId: "M1" });
    expect(h.sqls[0].p).toEqual(["M1"]);
    h.sqls = []; h.refMatch = null; h.rows = [{ id: "0f1e2d3c-aaaa-bbbb-cccc-000000000000", match_id: null }];
    expect(await resolveFollowupByReference("QF-0F1E2D3C")).toEqual({ followupId: "0f1e2d3c-aaaa-bbbb-cccc-000000000000", matchId: null });
    expect(h.sqls[0].sql).toContain("REPLACE(id, '-', '') LIKE ?");
    expect(h.sqls[0].p).toEqual(["0f1e2d3c%"]);
    expect(await resolveFollowupByReference("junk")).toBeNull();
  });
  it("callReference: the match reference when booked, else QF-", async () => {
    expect(await callReference({ id: "0f1e2d3c-aaaa", matchId: "M1" } as FollowupRow)).toBe("HRMS-021");
    expect(await callReference({ id: "0f1e2d3c-aaaa", matchId: null } as FollowupRow)).toBe("QF-0F1E2D3C");
  });
  it("a stamp by reference touches only that row", async () => {
    h.refMatch = "M1"; h.rows = [owned({ match_id: "M1" })];
    await stampFollowupCallResult({ mobile10: "9876543210", reference: "HRMS-041", result: "answered_confirmed", at: AT });
    expect(updates()[0].p.at(-1)).toBe("F1");
  });
});

describe("calling file dedupe with HR's manual exports", () => {
  const cand = (o: Partial<CallFileCandidate> = {}): CallFileCandidate => ({
    id: "r1", sourceType: "meta_live", mobile10: "9876543210", fullName: "asha", roleName: "CSE", requisitionId: "R1", requisitionCode: "REQ-1",
    branchName: "Noida", branchAddress: "x", campaign: "c", qualifiedAt: "2026-10-07 09:00:00", emailStatus: "sent", emailSentAt: null, waStatus: "sent",
    waSentAt: null, slotDate: null, slotTime: null, leadStatus: null, consentRevoked: false, matchStates: [], rowDeclined: false,
    callsN: 0, callsAnswered: 0, callsRetryable: 0, lastCallAt: null, metaOutcome: null, filesN: 0, lastFileAt: null, ...o,
  });
  it("a person exported by HR 3 h ago is not in the batch (already_exported)", () => {
    const p = planCallFile([cand({ exportedRecently: true }), cand({ id: "r2", mobile10: "9876543211" })], { now: AT, coolDays: 0 });
    expect(p.rows.map((r) => r.best.id)).toEqual(["r2"]);
    expect(p.skipped).toEqual([{ id: "r1", reason: "already_exported" }]);
  });
});
