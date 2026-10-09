import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stage A for every source (Task 9): booking before the first send, one owner per person, the guard chain with the shared budget and
 * canary caps, shadow rows for dry_run, and what a first successful send records. Lower layers are mocked; the db mock records SQL.
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  book: vi.fn(), claim: vi.fn(), facts: vi.fn(), note: vi.fn(), release: vi.fn(), skip: vi.fn(), branchToday: vi.fn(), markInvited: vi.fn(),
  personFacts: vi.fn(), releaseBooking: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string, p: unknown[] = []) => { h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p }); return [{ affectedRows: 1 }]; }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../followup-booking.service.js", () => ({ bookJourney: h.book, markInvitedAfterSend: h.markInvited, releaseJourneyBooking: h.releaseBooking }));
vi.mock("../followup-person.service.js", () => ({ claimPerson: h.claim, notePersonFirstContact: h.note, releasePerson: h.release, personFacts: h.personFacts }));
vi.mock("../followup-guard-facts.service.js", () => ({ loadGuardFacts: h.facts }));
vi.mock("../followup-guards.service.js", async (orig) => ({ ...(await orig<typeof import("../followup-guards.service.js")>()), recordGuardSkip: h.skip, branchFirstContactsToday: h.branchToday }));

import { afterFirstSend, beginJourney, gate, newBudget, scopeFilter } from "../qualified-followup.stagea.js";
import { readSwitches } from "../qualified-followup.policy.js";
import type { FollowupRow } from "../qualified-followup.context.js";
import type { GuardFacts } from "../followup-guards.js";

const THU_11 = new Date("2026-10-08T05:30:00Z");
const SUN_11 = new Date("2026-10-11T05:30:00Z");
const S = readSwitches({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_TO_PHONE: "9999999999" } as NodeJS.ProcessEnv, new Map([["policy.followup.meta_live", 4], ["policy.followup.he", 4]]));
const row = (o: Partial<FollowupRow> = {}): FollowupRow => ({
  id: "F1", sourceType: "meta_live", metaLeadId: "ML1", heLeadId: "L1", atsCandidateId: null, requisitionId: "R1", driveId: null,
  mobile10: "9876543210", email: "a@x.in", fullName: "Asha", branchName: "AHMEDABAD-JALDARSHAN", roleName: "CSE", qualifiedAt: THU_11,
  emailDueAt: THU_11, emailStatus: null, emailAttempts: 0, waDueAt: null, waStatus: null, waAttempts: 0, callDueAt: null, callState: "pending", callAttempts: 0,
  matchId: null, journeyState: "enrolled", reinviteNo: 0, heldReason: null, modeAtEnqueue: "live", ...o,
});
const baseFacts = (o: Partial<GuardFacts> = {}): GuardFacts => ({
  now: THU_11, step: "whatsapp", transactional: false, firstContact: true, killSwitch: false, sourceRunnable: true, sourcePaused: false, optedOut: false,
  requisition: { approvalStatus: "approved", activeStatus: 1, closedAt: null, requestedHeadcount: 5, fulfilledHeadcount: 0 }, journeyEnded: null,
  waUnpromptedToday: 0, lastUnpromptedAt: null, lastCadenceStepAt: null, cadenceStep: true, callAttemptsToday: 0, lastCallAt: null,
  waBudgetLeft: 100, branchCapLeft: null, lastFirstContactOtherReqAt: null, hrOverride: false, channelAllowed: true, uploadWithoutOptIn: false,
  uploadWaAllowed: false, templateApproved: true, missingVariables: [], ...o,
});
const scope = (waLeft = 100) => ({ sources: ["meta_live" as const, "he" as const], budget: newBudget(waLeft) });
const writes = () => h.sqls.filter((s) => /^(INSERT|UPDATE)/.test(s.sql));

beforeEach(() => {
  h.sqls = [];
  for (const f of [h.book, h.claim, h.facts, h.note, h.release, h.skip, h.branchToday, h.markInvited, h.personFacts, h.releaseBooking]) f.mockReset();
  h.book.mockResolvedValue({ status: "booked", matchId: "M1", driveId: "D1", slotAt: "2026-10-09 10:00:00" });
  h.claim.mockResolvedValue(true);
  h.personFacts.mockResolvedValue({ activeFollowupId: null, lastFirstContactAt: null, reinvites30d: 0, optedOutAt: null });
  h.facts.mockImplementation(async (i: { now: Date; step: GuardFacts["step"]; waBudgetLeft: number; branchCapLeft: number | null; firstContact: boolean; killSwitch: boolean }) =>
    baseFacts({ now: i.now, step: i.step, waBudgetLeft: i.waBudgetLeft, branchCapLeft: i.branchCapLeft, firstContact: i.firstContact, killSwitch: i.killSwitch }));
  h.skip.mockResolvedValue(true);
  h.branchToday.mockResolvedValue(0);
});

describe("scope", () => {
  it("selects only the sources of this tag and journeys in stage A", () => {
    expect(scopeFilter(scope())).toEqual({ sql: " AND qf.source_type IN (?,?) AND qf.journey_state IN ('enrolled','reach')", params: ["meta_live", "he"] });
  });
});

describe("beginJourney", () => {
  it("booking happens before the first send and the row carries the match", async () => {
    const r = await beginJourney(S, "live", row(), THU_11);
    expect(h.book).toHaveBeenCalledWith(expect.objectContaining({ id: "F1" }), { now: THU_11, simulate: false });
    expect(r).toEqual({ held: false, row: expect.objectContaining({ matchId: "M1", driveId: "D1" }) });
    expect(h.claim).toHaveBeenCalledWith("9876543210", "F1");
  });
  it("a person claimed by another journey is held_best_offer, nothing sent", async () => {
    h.claim.mockResolvedValue(false);
    const r = await beginJourney(S, "live", row(), THU_11);
    expect(r.held).toBe(true);
    expect(writes()[0]).toEqual({ sql: "UPDATE qualified_followup SET journey_state = 'held_best_offer' WHERE id = ? AND journey_state IN ('enrolled','held_best_offer')", p: ["F1"] });
  });
  it("E1: the claim comes first: a lost claim books nothing, so a held row re-checked every tick never takes a seat", async () => {
    h.claim.mockResolvedValue(false);
    for (let i = 0; i < 3; i++) expect((await beginJourney(S, "live", row({ journeyState: i ? "held_best_offer" : "enrolled" }), THU_11)).held).toBe(true);
    expect(h.book).not.toHaveBeenCalled();
  });
  it("a journey already in reach is not booked or claimed again", async () => {
    await beginJourney(S, "live", row({ journeyState: "reach", matchId: "M1" }), THU_11);
    expect(h.book).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
  });
  it("dry_run simulates the booking and never claims (reads the holder instead)", async () => {
    h.book.mockResolvedValue({ status: "would_book", driveDate: "2026-10-09" });
    h.personFacts.mockResolvedValue({ activeFollowupId: "OTHER", lastFirstContactAt: null, reinvites30d: 0, optedOutAt: null });
    const r = await beginJourney(S, "dry_run", row({ modeAtEnqueue: "dry_run" }), THU_11);
    expect(h.book).toHaveBeenCalledWith(expect.anything(), { now: THU_11, simulate: true });
    expect(h.claim).not.toHaveBeenCalled();
    expect(r.held).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  it("test rows book for real only for the owner's test phone", async () => {
    await beginJourney(S, "test", row({ modeAtEnqueue: "test" }), THU_11);
    expect(h.book.mock.calls[0][1]).toEqual({ now: THU_11, simulate: true });
    await beginJourney(S, "test", row({ modeAtEnqueue: "test", mobile10: "9999999999" }), THU_11);
    expect(h.book.mock.calls[1][1]).toEqual({ now: THU_11, simulate: false });
  });
});

describe("gate", () => {
  it("passes with every fact ok", async () => {
    expect(await gate(S, "live", row(), "whatsapp", THU_11, scope(), { firstContact: true, templateKey: "he_walkin_invite" })).toEqual({ action: "send" });
  });
  it("shared budget 0 holds WhatsApp (due moved, no failure) and records the skip", async () => {
    const g = await gate(S, "live", row(), "whatsapp", THU_11, scope(0), { firstContact: true, templateKey: "he_walkin_invite" });
    expect(g).toEqual({ action: "held", reason: "wa_budget" });
    const u = writes().find((w) => w.sql.startsWith("UPDATE qualified_followup SET wa_due_at = ?"))!;
    expect(u.p[0]).toEqual(new Date("2026-10-09T03:30:00Z"));
    expect(h.skip).toHaveBeenCalledWith("F1", "L1", "whatsapp", "wa_budget", THU_11);
  });
  it("outside the window: due time moves to Monday 09:00, no failure counted", async () => {
    h.facts.mockImplementation(async (i: { now: Date; step: GuardFacts["step"] }) => baseFacts({ now: i.now, step: i.step }));
    const g = await gate(S, "live", row(), "email", SUN_11, scope(), { firstContact: true, templateKey: null });
    expect(g).toEqual({ action: "held", reason: "outside_window" });
    expect(writes()[0]).toEqual({ sql: "UPDATE qualified_followup SET email_due_at = ? WHERE id = ?", p: [new Date("2026-10-12T03:30:00Z"), "F1"] });
  });
  it("canary branch cap: AHMEDABAD cap 30 with 30 first contacts today holds; NOIDA-2 proceeds", async () => {
    h.branchToday.mockImplementation(async (prefix: string) => (prefix === "AHMEDABAD" ? 30 : 0));
    const sc = scope();
    expect(await gate(S, "canary", row({ modeAtEnqueue: "canary" }), "email", THU_11, sc, { firstContact: true, templateKey: null })).toEqual({ action: "held", reason: "branch_cap" });
    expect(await gate(S, "canary", row({ id: "F2", modeAtEnqueue: "canary", branchName: "NOIDA-2" }), "email", THU_11, sc, { firstContact: true, templateKey: null })).toEqual({ action: "send" });
    expect(h.branchToday).toHaveBeenCalledTimes(2); // once per prefix per tick, then the budget map
    await gate(S, "canary", row({ id: "F3", modeAtEnqueue: "canary" }), "email", THU_11, sc, { firstContact: true, templateKey: null });
    expect(h.branchToday).toHaveBeenCalledTimes(2);
  });
  it("live rows have no branch cap", async () => {
    await gate(S, "live", row(), "email", THU_11, scope(), { firstContact: true, templateKey: null });
    expect(h.facts.mock.calls[0][0].branchCapLeft).toBeNull();
  });
  it("end_journey stops the row and releases the person", async () => {
    h.facts.mockResolvedValue(baseFacts({ optedOut: true }));
    expect(await gate(S, "live", row(), "email", THU_11, scope(), { firstContact: true, templateKey: null })).toEqual({ action: "ended", reason: "opted_out" });
    expect(writes()[0].sql).toContain("SET stopped_reason = ?, stopped_at = NOW(), journey_state = 'stopped'");
    expect(h.release).toHaveBeenCalledWith("9876543210", "F1");
    expect(h.releaseBooking).toHaveBeenCalledWith("F1"); // E1: the journey's unconfirmed seat goes back
  });
  it("E2: criteria_review in stage A holds the journey for HR (held_manual), never a due time pushed again and again", async () => {
    h.facts.mockResolvedValue(baseFacts({ criteriaVerdict: "review" }));
    expect(await gate(S, "live", row(), "email", THU_11, scope(), { firstContact: true, templateKey: null })).toEqual({ action: "held", reason: "criteria_review" });
    expect(writes().map((w) => w.sql)).toEqual(["UPDATE qualified_followup SET journey_state = 'held_manual', held_reason = 'criteria_review' WHERE id = ? AND stopped_reason IS NULL AND journey_state IN ('enrolled','reach','engaged','held_best_offer','reinvite_wait')"]);
  });
  it("skip_step returns the reason for the step to record", async () => {
    h.facts.mockResolvedValue(baseFacts({ channelAllowed: false }));
    expect(await gate(S, "live", row(), "whatsapp", THU_11, scope(), { firstContact: true, templateKey: "he_walkin_invite" })).toEqual({ action: "skipped", reason: "channel_off" });
  });
  it("dry_run writes followup_shadow (would_send) and applies nothing", async () => {
    const g = await gate(S, "dry_run", row({ modeAtEnqueue: "dry_run" }), "whatsapp", THU_11, scope(), { firstContact: true, templateKey: "he_walkin_invite" });
    expect(g).toEqual({ action: "shadowed", verdict: "would_send", held: false });
    const ins = writes()[0];
    expect(ins.sql).toContain("INSERT INTO followup_shadow");
    expect(ins.p.slice(0, 7)).toEqual(["F1", "9876543210", "R1", "meta_live", "whatsapp", "he_walkin_invite", "would_send"]);
    expect(h.skip).not.toHaveBeenCalled();
  });
  it("dry_run shadow records the guard reason instead of holding", async () => {
    const g = await gate(S, "dry_run", row({ modeAtEnqueue: "dry_run" }), "whatsapp", THU_11, scope(0), { firstContact: true, templateKey: "he_walkin_invite" });
    expect(g).toEqual({ action: "shadowed", verdict: "wa_budget", held: true });
    expect(writes()).toHaveLength(1);
  });
  it("kill switch holds every send", async () => {
    const K = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv, new Map([["policy.followup.paused", 1], ["policy.followup.meta_live", 4]]));
    expect((await gate(K, "live", row(), "email", THU_11, scope(), { firstContact: true, templateKey: null })).action).toBe("held");
    expect(h.facts.mock.calls[0][0].killSwitch).toBe(true);
  });
});

describe("afterFirstSend", () => {
  it("reach, person first contact, match invited, Meta notified mirror, canary cap spent", async () => {
    const sc = scope();
    sc.budget.branchLeft.set("AHMEDABAD", 5);
    await afterFirstSend(S, "canary", row({ matchId: "M1", modeAtEnqueue: "canary" }), "email", THU_11, sc);
    expect(writes().map((w) => w.sql)).toEqual([
      "UPDATE qualified_followup SET journey_state = 'reach' WHERE id = ? AND journey_state = 'enrolled'",
      "UPDATE meta_lead_raw SET notification_sent_at = COALESCE(notification_sent_at, ?), notification_channels = JSON_ARRAY_APPEND(COALESCE(notification_channels, JSON_ARRAY()), '$', ?) WHERE id = ? AND NOT JSON_CONTAINS(COALESCE(notification_channels, JSON_ARRAY()), JSON_QUOTE(?))",
    ]);
    expect(h.note).toHaveBeenCalledWith("9876543210", THU_11, { reinvite: false });
    expect(h.markInvited).toHaveBeenCalledWith("M1");
    expect(sc.budget.branchLeft.get("AHMEDABAD")).toBe(4);
  });
  it("test rows record nothing about the person (the message went to the owner)", async () => {
    await afterFirstSend(S, "test", row({ matchId: "M1", modeAtEnqueue: "test" }), "email", THU_11, scope());
    expect(h.note).not.toHaveBeenCalled();
    expect(writes().some((w) => w.sql.includes("meta_lead_raw"))).toBe(false);
  });
});

describe("beginJourney re-books a row that already carries a match", () => {
  it("a re-invite (old no-show match) or a line-up match without a slot is booked before the first send", async () => {
    h.book.mockResolvedValue({ status: "booked", matchId: "M1", driveId: "D9", slotAt: "2026-10-17 10:00:00" });
    const r = await beginJourney(S, "live", row({ matchId: "M1", reinviteNo: 1 }), THU_11);
    expect(h.book).toHaveBeenCalledTimes(1);
    expect(r.row.driveId).toBe("D9");
  });
});
