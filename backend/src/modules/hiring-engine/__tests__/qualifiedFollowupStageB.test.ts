import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stage B for every source (Task 11): confirm, reschedule, D-1, 2 h, no-show, arrival, re-invite; journeys found by their match. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  sel: {} as Record<string, Array<Record<string, unknown>>>,
  dupT2: false, events: [] as unknown[][], person: { lastFirstContactAt: null as Date | null, reinvites30d: 0 },
  send: vi.fn(), email: vi.fn(), facts: vi.fn(), release: vi.fn(), reserve: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      const tag = /\/\* stageb:(\w+) \*\//.exec(q)?.[1];
      if (tag) return [h.sel[tag] ?? []];
      if (q.includes("FROM he_message w WHERE w.lead_id = ?")) return [h.dupT2 ? [{ hit: 1 }] : []];
      if (q.includes("COUNT(*) AS n FROM he_lead_event e WHERE e.lead_id = ? AND e.event_type = 'reschedule_requested'")) return [[{ n: Number(p[1] ?? 0) }]];
      if (q.includes("AS approaches")) return [[{ approaches: 0, no_shows: 0, lead_status: "contacted" }]];
      if (q.startsWith("SELECT")) return [[]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-send.service.js", async (orig) => ({ ...(await orig<typeof import("../he-send.service.js")>()), sendTemplateToLead: h.send }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: h.email }));
vi.mock("../followup-guard-facts.service.js", () => ({ loadGuardFacts: h.facts }));
vi.mock("../followup-person.service.js", () => ({ releasePerson: h.release, personFacts: vi.fn(async () => ({ activeFollowupId: null, optedOutAt: null, ...h.person })) }));
vi.mock("../he-drive.service.js", () => ({ reserveSlot: h.reserve }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(async (...a: unknown[]) => { h.events.push(a); }) }));
vi.mock("../he-reroute.service.js", () => ({ offerOtherRoles: vi.fn(async () => ({ considered: 0, offered: 0, noAlternative: 0, blocked: {}, dryRun: 0 })) }));

import { journeyAfterReply, runStageB, sendTransactionalForJourney } from "../qualified-followup.stageb.js";
import { newBudget } from "../qualified-followup.stagea.js";
import { readSwitches } from "../qualified-followup.policy.js";
import { decideStop } from "../qualified-followup.rules.js";
import { toFollowupRow } from "../qualified-followup.context.js";
import type { GuardFacts } from "../followup-guards.js";

const ist = (s: string) => new Date(`${s}+05:30`);
const S = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv, new Map([["policy.followup.meta_live", 4], ["policy.followup.he", 4]]));
const jrow = (o: Record<string, unknown> = {}) => ({
  id: "F1", source_type: "meta_live", meta_lead_id: "ML1", he_lead_id: "L1", ats_candidate_id: null, requisition_id: "R1", drive_id: "D1",
  mobile10: "9876543210", email: "a@x.in", full_name: "Asha", branch_name: "NOIDA-2", role_name: "CSE", qualified_at: "2026-10-01 10:00:00",
  email_due_at: null, email_status: "sent", email_attempts: 0, wa_due_at: null, wa_status: "sent", wa_attempts: 0, call_due_at: null, call_state: "called", call_attempts: 0,
  match_id: "M1", journey_state: "confirmed", reinvite_no: 0, held_reason: null, mode_at_enqueue: "live",
  m_state: "confirmed", m_slot: "2026-10-13 14:00:00", m_drive: "D1", m_lead: "L1", ...o,
});
const facts = (o: Partial<GuardFacts> = {}) => async (i: { now: Date; step: GuardFacts["step"]; transactional: boolean; waBudgetLeft: number; stage?: "A" | "B" }): Promise<GuardFacts> => ({
  now: i.now, step: i.step, transactional: i.transactional, firstContact: false, killSwitch: false, sourceRunnable: true, sourcePaused: false, optedOut: false,
  requisition: { approvalStatus: "approved", activeStatus: 1, closedAt: null, requestedHeadcount: 5, fulfilledHeadcount: 0 }, journeyEnded: null,
  waUnpromptedToday: 0, lastUnpromptedAt: null, lastCadenceStepAt: null, cadenceStep: false, callAttemptsToday: 0, lastCallAt: null,
  waBudgetLeft: i.waBudgetLeft, branchCapLeft: null, lastFirstContactOtherReqAt: null, hrOverride: false, channelAllowed: true, uploadWithoutOptIn: false,
  uploadWaAllowed: false, templateApproved: true, missingVariables: [], stage: i.stage, ...o,
});
const scope = (waLeft = 100) => ({ sources: ["meta_live" as const, "he" as const], budget: newBudget(waLeft) });
const sentKeys = () => h.send.mock.calls.map((c) => c[0].key);
const find = (re: RegExp) => h.sqls.filter((s) => re.test(s.sql));

beforeEach(() => {
  h.sqls = []; h.sel = {}; h.dupT2 = false; h.events = []; h.person = { lastFirstContactAt: null, reinvites30d: 0 };
  for (const f of [h.send, h.email, h.facts, h.release, h.reserve]) f.mockReset();
  h.send.mockResolvedValue({ status: "sent", messageId: "m", providerMessageId: "p" });
  h.email.mockResolvedValue({ status: "sent" });
  h.facts.mockImplementation(facts());
  h.reserve.mockResolvedValue("2026-10-14 11:00:00");
});

describe("journeyAfterReply (pure)", () => {
  const plan = (o: Record<string, unknown>) => ({ leadStatus: null, matchState: null, offerSlot: false, humanHandoff: false, revokeConsent: false, event: "reply", ...o }) as never;
  it("any reply ends stage A; confirm / decline / STOP set their state; later states are kept", () => {
    expect(journeyAfterReply("reach", plan({}))).toBe("engaged");
    expect(journeyAfterReply("enrolled", plan({}))).toBe("engaged");
    expect(journeyAfterReply("reach", plan({ matchState: "confirmed" }))).toBe("confirmed");
    expect(journeyAfterReply("confirmed", plan({ matchState: "declined" }))).toBe("declined");
    expect(journeyAfterReply("reminded", plan({ event: "opted_out" }))).toBe("stopped");
    expect(journeyAfterReply("reminded", plan({}))).toBe("reminded");
  });
  it("decideStop no longer stops on replied", () => {
    expect(decideStop({ optedOut: false, repliedSinceQualified: true, requisitionClosed: null, joined: false, hasMobile: true, hasEmail: true })).toBeNull();
  });
});

describe("transactional answers for an owned journey", () => {
  const row = () => toFollowupRow(jrow({ journey_state: "engaged" }) as never);
  it("confirm -> T2 + confirmation email once (any hour, tagged followup); a second Yes sends nothing", async () => {
    const r = await sendTransactionalForJourney(row(), "he_walkin_confirmed", { now: ist("2026-10-12T22:30:00") });
    expect(r.status).toBe("sent");
    expect(h.send.mock.calls[0][0]).toMatchObject({ key: "he_walkin_confirmed", matchId: "M1", transactional: true, sentBy: "followup" });
    expect(h.email).toHaveBeenCalledWith("confirmed", "M1", { sentBy: "followup" });
    h.dupT2 = true; h.send.mockClear(); h.email.mockClear();
    await sendTransactionalForJourney(row(), "he_walkin_confirmed", { now: ist("2026-10-12T22:31:00") });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
  });
  it("Live Meta confirm works because the journey has a match", async () => {
    await sendTransactionalForJourney(toFollowupRow(jrow({ source_type: "meta_live" }) as never), "he_walkin_confirmed", { now: ist("2026-10-12T12:00:00") });
    expect(h.send.mock.calls[0][0].matchId).toBe("M1");
  });
  it("T10 (STOP acknowledgement) passes the opted_out guard; other answers do not", async () => {
    h.facts.mockImplementation(facts({ optedOut: true }));
    expect((await sendTransactionalForJourney(row(), "he_optout_ack", { now: ist("2026-10-12T12:00:00") })).status).toBe("sent");
    expect((await sendTransactionalForJourney(row(), "he_walkin_confirmed", { now: ist("2026-10-12T12:00:00") })).status).toBe("blocked");
  });
  it("kill switch blocks even transactional answers", async () => {
    h.facts.mockImplementation(facts({ killSwitch: true }));
    expect((await sendTransactionalForJourney(row(), "he_walkin_confirmed", { now: ist("2026-10-12T12:00:00") })).status).toBe("blocked");
  });
});

describe("runStageB reminders", () => {
  it("T3 + D-1 email 22-26 h before a Tue 14:00 slot; journey reminded; reminder_1d_sent recorded", async () => {
    h.sel.reminders = [jrow()];
    const sc = scope(5);
    const c = await runStageB(S, "live", ist("2026-10-12T14:30:00"), sc);
    expect(sentKeys()).toEqual(["he_reminder_1d"]);
    expect(h.email).toHaveBeenCalledWith("reminder_1d", "M1", { sentBy: "followup" });
    expect(h.events).toContainEqual(["L1", "reminder_1d_sent", expect.objectContaining({ driveId: "D1" })]);
    expect(find(/SET journey_state = 'reminded'/)).toHaveLength(1);
    expect(c.d1.sent).toBe(1);
    expect(sc.budget.waLeft).toBe(4); // stage B spends the shared budget first
  });
  it("not for an invited (unconfirmed) match", async () => {
    h.sel.reminders = [jrow({ m_state: "invited", journey_state: "reach" })];
    await runStageB(S, "live", ist("2026-10-12T14:30:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
  });
  it("too early for the D-1 (30 h before) sends nothing", async () => {
    h.sel.reminders = [jrow()];
    await runStageB(S, "live", ist("2026-10-12T08:00:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
  });
  it("Monday 10:00 slot -> T3 on Saturday 19:00 IST", async () => {
    h.sel.reminders = [jrow({ m_slot: "2026-10-12 10:00:00" })];
    await runStageB(S, "live", ist("2026-10-10T18:55:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
    await runStageB(S, "live", ist("2026-10-10T19:02:00"), scope());
    expect(sentKeys()).toEqual(["he_reminder_1d"]);
  });
  it("T4 for a 10:30 slot goes at 09:00 the same day; a 14:00 slot at 12:00", async () => {
    h.sel.reminders = [jrow({ m_slot: "2026-10-13 10:30:00", journey_state: "reminded" })];
    h.sqls = [];
    await runStageB(S, "live", ist("2026-10-13T09:02:00"), scope());
    expect(sentKeys()).toEqual(["he_reminder_2h_location"]);
    h.send.mockClear();
    h.sel.reminders = [jrow({ m_slot: "2026-10-13 14:00:00", journey_state: "reminded" })];
    await runStageB(S, "live", ist("2026-10-13T11:55:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
    await runStageB(S, "live", ist("2026-10-13T12:01:00"), scope());
    expect(sentKeys()).toEqual(["he_reminder_2h_location"]);
  });
  it("a reminder already recorded for the drive is not sent again", async () => {
    h.sel.reminders = [jrow({ d1_done: 1 })];
    await runStageB(S, "live", ist("2026-10-12T14:30:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
  });
  it("stage B is served before stage A when the budget is short: budget 0 holds the T3", async () => {
    h.sel.reminders = [jrow()];
    const sc = scope(0);
    await runStageB(S, "live", ist("2026-10-12T14:30:00"), sc);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("runStageB after the slot", () => {
  it("confirmed no-show -> T6 + email once (first no-show only), then reinvite_wait and the person is released", async () => {
    h.sel.noshow = [jrow({ m_state: "no_show", m_slot: "2026-10-12 11:00:00", no_shows: 1 })];
    await runStageB(S, "live", ist("2026-10-12T13:30:00"), scope());
    expect(sentKeys()).toEqual(["he_no_show_recovery"]);
    expect(h.email).toHaveBeenCalledWith("no_show", "M1", { sentBy: "followup" });
    expect(h.events).toContainEqual(["L1", "no_show_recovery_sent", expect.objectContaining({ driveId: "D1" })]);
    expect(find(/SET journey_state = 'reinvite_wait'/)).toHaveLength(1);
    expect(h.release).toHaveBeenCalledWith("9876543210", "F1");
  });
  it("a second no-show gets no T6", async () => {
    h.sel.noshow = [jrow({ m_state: "no_show", m_slot: "2026-10-12 11:00:00", no_shows: 2 })];
    await runStageB(S, "live", ist("2026-10-12T13:30:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
    expect(find(/SET journey_state = 'reinvite_wait'/)).toHaveLength(1);
  });
  it("invited (never confirmed) no-show -> no message, reinvite_wait", async () => {
    h.sel.noshow = [jrow({ m_state: "no_show", journey_state: "reach", m_slot: "2026-10-12 11:00:00", no_shows: 1 })];
    await runStageB(S, "live", ist("2026-10-12T13:30:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
    expect(find(/SET journey_state = 'reinvite_wait'/)).toHaveLength(1);
  });
  it("arrived (arrival sync ran first) -> journey arrived, no T6", async () => {
    await runStageB(S, "live", ist("2026-10-12T13:30:00"), scope());
    expect(find(/SET qf.journey_state = 'arrived'/)).toHaveLength(1);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("re-invite (D7)", () => {
  const waiting = () => jrow({ journey_state: "reinvite_wait", m_state: "no_show" });
  it("after 7 days the journey re-enters stage A (reinvite_no + 1, steps reset)", async () => {
    h.sel.reinvite = [waiting()];
    h.person.lastFirstContactAt = ist("2026-10-05T10:00:00");
    await runStageB(S, "live", ist("2026-10-12T11:00:00"), scope());
    const u = find(/SET reinvite_no = reinvite_no \+ 1/)[0];
    expect(u.sql).toContain("journey_state = 'enrolled'");
    expect(u.sql).toContain("email_status = NULL");
    expect(u.sql).toContain("WHERE id = ? AND journey_state = 'reinvite_wait'");
  });
  it("not at 6 days, not a third time in 30 days", async () => {
    h.sel.reinvite = [waiting()];
    h.person.lastFirstContactAt = ist("2026-10-06T12:00:00");
    await runStageB(S, "live", ist("2026-10-12T11:00:00"), scope());
    expect(find(/SET reinvite_no = reinvite_no \+ 1/)).toHaveLength(0);
    h.person = { lastFirstContactAt: ist("2026-09-01T10:00:00"), reinvites30d: 2 };
    await runStageB(S, "live", ist("2026-10-12T11:00:00"), scope());
    expect(find(/SET reinvite_no = reinvite_no \+ 1/)).toHaveLength(0);
  });
  it("a declined journey is never re-invited", async () => {
    h.sel.reinvite = [jrow({ journey_state: "reinvite_wait", m_state: "declined" })];
    h.person.lastFirstContactAt = ist("2026-09-01T10:00:00");
    await runStageB(S, "live", ist("2026-10-12T11:00:00"), scope());
    expect(find(/SET reinvite_no = reinvite_no \+ 1/)).toHaveLength(0);
  });
});

describe("reschedule (T5)", () => {
  it("reschedule -> a new slot reserved, T5 + email, match invited", async () => {
    h.sel.reschedule = [jrow({ m_state: "slot_released", journey_state: "engaged", requests: 1 })];
    await runStageB(S, "live", ist("2026-10-12T11:00:00"), scope());
    expect(h.reserve).toHaveBeenCalledWith("M1", true);
    expect(sentKeys()).toEqual(["he_reschedule_offer"]);
    expect(h.email).toHaveBeenCalledWith("reschedule_offer", "M1", { sentBy: "followup" });
    expect(find(/UPDATE he_match SET state = 'invited' WHERE id = \?/)).toHaveLength(1);
  });
  it("second request -> human, no message", async () => {
    h.sel.reschedule = [jrow({ m_state: "slot_released", journey_state: "engaged", requests: 2 })];
    await runStageB(S, "live", ist("2026-10-12T11:00:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
    expect(h.events).toContainEqual(["L1", "needs_human_followup", expect.objectContaining({ detail: "second reschedule request" })]);
  });
  it("no free slot -> human", async () => {
    h.reserve.mockResolvedValue(null);
    h.sel.reschedule = [jrow({ m_state: "slot_released", journey_state: "engaged", requests: 1 })];
    await runStageB(S, "live", ist("2026-10-12T11:00:00"), scope());
    expect(h.send).not.toHaveBeenCalled();
    expect(h.events).toContainEqual(["L1", "needs_human_followup", expect.objectContaining({ detail: "no free slot to reschedule into" })]);
  });
});
