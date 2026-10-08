import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real email / WhatsApp steps in unified mode (a StepScope from the worker) with the real stage A helpers; booking, the person lock and
 * the guard facts are mocked so each test sets one fact. Covers Task 9's step-level behaviour.
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
  t9: [] as Array<Record<string, unknown>>,
  sendTpl: vi.fn(), mailSend: vi.fn(), book: vi.fn(), claim: vi.fn(), facts: vi.fn(),
  queueSb: vi.fn(), placeVoice: vi.fn(), sbConfig: vi.fn(), release: vi.fn(),
}));
vi.mock("../he-superbot.service.js", () => ({ queueSuperbotCall: h.queueSb }));
vi.mock("../he-voice.service.js", () => ({ placeVoiceCall: h.placeVoice }));
vi.mock("../he-secrets.service.js", () => ({ superbotConfig: h.sbConfig }));
vi.mock("../he-call-ref.service.js", () => ({ refForMatch: vi.fn(async () => "HRMS-041"), matchForRef: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.startsWith("SELECT") && q.includes("qf.missed_call_due_at IS NOT NULL")) return [h.t9];
      if (q.startsWith("SELECT") && q.includes("FROM qualified_followup qf")) return [h.rows];
      if (q.includes("FROM he_match WHERE id = ?")) return [[{ id: "M1", slot_at: "2026-10-09 11:00:00", token: "tok-m1" }]];
      if (q.includes("FROM branch_master")) return [[{ address: "Jaldarshan, Ahmedabad", latitude: null, longitude: null }]];
      if (q.includes("FROM job_requisition")) return [[{ bmi_assessment_url: null }]];
      if (q.includes("SELECT status FROM he_lead")) return [[{ status: "new" }]];
      if (q.startsWith("SELECT")) return [[]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-send.service.js", async (orig) => ({ ...(await orig<typeof import("../he-send.service.js")>()), sendTemplateToLead: h.sendTpl }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: h.mailSend } }));
vi.mock("../followup-booking.service.js", () => ({ bookJourney: h.book, markInvitedAfterSend: vi.fn() }));
vi.mock("../followup-person.service.js", () => ({ claimPerson: h.claim, notePersonFirstContact: vi.fn(), releasePerson: h.release, personFacts: vi.fn(async () => ({ activeFollowupId: null })) }));
vi.mock("../followup-guard-facts.service.js", () => ({ loadGuardFacts: h.facts }));
vi.mock("../he-best-offer.service.js", async (orig) => ({
  ...(await orig<typeof import("../he-best-offer.service.js")>()),
  selectWithOfferHolds: vi.fn(async (rows: unknown[]) => ({ rows, held: new Set<string>() })), markHeldBestOffer: vi.fn(),
}));

import { runEmailStep } from "../qualified-followup.email.js";
import { runWhatsappStep } from "../qualified-followup.whatsapp.js";
import { runCallStep } from "../qualified-followup.call.js";
import { newBudget, type StepScope } from "../qualified-followup.stagea.js";
import { readSwitches } from "../qualified-followup.policy.js";
import type { GuardFacts } from "../followup-guards.js";

const NOW = new Date("2026-10-08T05:30:00Z"); // Thu 11:00 IST
const S = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv, new Map([["policy.followup.meta_live", 4], ["policy.followup.he", 1]]));
const row = (o: Record<string, unknown> = {}) => ({
  id: "F1", source_type: "meta_live", meta_lead_id: "ML1", he_lead_id: "L1", ats_candidate_id: null, requisition_id: "R1", drive_id: null,
  mobile10: "9876543210", email: "a@x.in", full_name: "Asha Rao", branch_name: "AHMEDABAD-JALDARSHAN", role_name: "CSE", qualified_at: "2026-10-08 10:00:00",
  email_due_at: "2026-10-08 10:00:00", email_status: "sent", email_attempts: 0, wa_due_at: "2026-10-08 10:30:00", wa_status: null, wa_attempts: 0,
  call_due_at: null, call_state: "pending", call_attempts: 0, match_id: null, journey_state: "enrolled", reinvite_no: 0, held_reason: null, mode_at_enqueue: "live", ...o,
});
const facts = (o: Partial<GuardFacts> = {}) => async (i: { now: Date; step: GuardFacts["step"]; waBudgetLeft: number }): Promise<GuardFacts> => ({
  now: i.now, step: i.step, transactional: false, firstContact: true, killSwitch: false, sourceRunnable: true, sourcePaused: false, optedOut: false,
  requisition: { approvalStatus: "approved", activeStatus: 1, closedAt: null, requestedHeadcount: 5, fulfilledHeadcount: 0 }, journeyEnded: null,
  waUnpromptedToday: 0, lastUnpromptedAt: null, lastCadenceStepAt: null, cadenceStep: true, callAttemptsToday: 0, lastCallAt: null,
  waBudgetLeft: i.waBudgetLeft, branchCapLeft: null, lastFirstContactOtherReqAt: null, hrOverride: false, channelAllowed: true, uploadWithoutOptIn: false,
  uploadWaAllowed: false, templateApproved: true, missingVariables: [], ...o,
});
const scope = (waLeft = 100, sources: StepScope["sources"] = ["meta_live"]): StepScope => ({ sources, budget: newBudget(waLeft) });
const find = (re: RegExp) => h.sqls.filter((s) => re.test(s.sql));

beforeEach(() => {
  h.sqls = []; h.rows = [row()]; h.t9 = [];
  for (const f of [h.sendTpl, h.mailSend, h.book, h.claim, h.facts, h.queueSb, h.placeVoice, h.sbConfig, h.release]) f.mockReset();
  h.queueSb.mockResolvedValue({ ok: true });
  h.sbConfig.mockResolvedValue({ apiKey: "k" });
  h.sendTpl.mockResolvedValue({ status: "sent", messageId: "msg-1", providerMessageId: "p1" });
  h.mailSend.mockResolvedValue({ messageId: "mail-1" });
  h.book.mockResolvedValue({ status: "booked", matchId: "M1", driveId: "D1", slotAt: "2026-10-09 11:00:00" });
  h.claim.mockResolvedValue(true);
  h.facts.mockImplementation(facts());
});

describe("unified email step", () => {
  it("booking happens before the first email and the slot appears in it", async () => {
    h.rows = [row({ email_status: null, wa_due_at: null })];
    const c = await runEmailStep(S, "live", NOW, scope());
    expect(c.sent).toBe(1);
    expect(h.book).toHaveBeenCalledTimes(1);
    expect(h.book.mock.invocationCallOrder[0]).toBeLessThan(h.mailSend.mock.invocationCallOrder[0]);
    expect(h.mailSend.mock.calls[0][0].html).toContain("11:00 AM");
  });
  it("worker sends are tagged sent_by followup; the first send mirrors notification_sent_at for a Live Meta row and moves the journey to reach", async () => {
    h.rows = [row({ email_status: null, wa_due_at: null })];
    await runEmailStep(S, "live", NOW, scope());
    const ins = find(/^INSERT INTO he_message/)[0];
    expect(ins.sql).toContain(", sent_by)");
    expect(ins.p.at(-1)).toBe("followup");
    expect(find(/^UPDATE meta_lead_raw SET notification_sent_at = COALESCE/)[0].p.slice(1, 3)).toEqual(["email", "ML1"]);
    expect(find(/SET journey_state = 'reach'/)).toHaveLength(1);
  });
  it("selects only this tick's sources in stage A (a source switched off is frozen)", async () => {
    h.rows = [];
    await runEmailStep(S, "live", NOW, scope(100, ["meta_live"]));
    const sel = find(/^SELECT .* FROM qualified_followup qf/)[0];
    expect(sel.sql).toContain("AND qf.source_type IN (?) AND qf.journey_state IN ('enrolled','reach')");
    expect(sel.p).toContain("meta_live");
    expect(sel.p).not.toContain("he");
  });
  it("kill switch from the screen: no select, no send", async () => {
    const K = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv, new Map([["policy.followup.paused", 1], ["policy.followup.meta_live", 4]]));
    await runEmailStep(K, "live", NOW, scope());
    expect(h.sqls).toHaveLength(0);
    expect(h.mailSend).not.toHaveBeenCalled();
  });
  it("a person claimed by another journey: held_best_offer, nothing sent", async () => {
    h.rows = [row({ email_status: null })];
    h.claim.mockResolvedValue(false);
    const c = await runEmailStep(S, "live", NOW, scope());
    expect(c.held).toBe(1);
    expect(h.mailSend).not.toHaveBeenCalled();
    expect(find(/held_best_offer/)).toHaveLength(1);
  });
});

describe("unified WhatsApp step", () => {
  it("dry_run writes followup_shadow and never calls a sender", async () => {
    h.rows = [row({ mode_at_enqueue: "dry_run", match_id: "M1" })];
    h.book.mockResolvedValue({ status: "would_book", driveDate: "2026-10-09" });
    const D = readSwitches({ QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv, new Map([["policy.followup.meta_live", 1]]));
    await runWhatsappStep(D, "dry_run", NOW, scope());
    expect(h.sendTpl).not.toHaveBeenCalled();
    const sh = find(/^INSERT INTO followup_shadow/)[0];
    expect(sh.p.slice(4, 7)).toEqual(["whatsapp", "he_walkin_invite", "would_send"]);
  });
  it("shared budget counts engine sends too: 2 left -> exactly 2 WhatsApp, none failed", async () => {
    h.rows = [row({ id: "F1" }), row({ id: "F2", mobile10: "9876543211" }), row({ id: "F3", mobile10: "9876543212" })];
    const sc = scope(2);
    const c = await runWhatsappStep(S, "live", NOW, sc);
    expect(h.sendTpl).toHaveBeenCalledTimes(2);
    expect(c.failed).toBe(0);
    expect(sc.budget.waLeft).toBe(0);
    expect(find(/^SELECT .* FROM qualified_followup qf/)[0].sql).toContain("LIMIT 2");
  });
  it("RED quality (budget 0): no WhatsApp at all", async () => {
    await runWhatsappStep(S, "live", NOW, scope(0));
    expect(h.sendTpl).not.toHaveBeenCalled();
  });
  it("passes sentBy followup to the sender", async () => {
    await runWhatsappStep(S, "live", NOW, scope());
    expect(h.sendTpl.mock.calls[0][0]).toMatchObject({ sentBy: "followup", key: "he_walkin_invite", matchId: "M1" });
  });
  it("an expired 'sending' claim is never selected again (only wa_status IS NULL rows)", async () => {
    h.rows = [];
    await runWhatsappStep(S, "live", NOW, scope());
    expect(find(/^SELECT .* FROM qualified_followup qf/)[0].sql).toContain("qf.wa_status IS NULL AND qf.wa_sent_at IS NULL");
  });
  it("outside the window (Sunday) the row is held to Monday 09:00, not failed", async () => {
    h.facts.mockImplementation(facts());
    const sun = new Date("2026-10-11T05:30:00Z");
    const c = await runWhatsappStep(S, "live", sun, scope());
    expect(c.failed).toBe(0);
    expect(find(/^UPDATE qualified_followup SET wa_due_at = \?/)[0].p[0]).toEqual(new Date("2026-10-12T03:30:00Z"));
    expect(h.sendTpl).not.toHaveBeenCalled();
  });
});

describe("unified call step (Task 10)", () => {
  const BOT = readSwitches({ QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_BOT_SOURCES: "he,meta_live" } as NodeJS.ProcessEnv, new Map([["policy.followup.meta_live", 4], ["policy.followup.he", 4]]));
  const callRow = (o: Record<string, unknown> = {}) => row({ wa_status: "sent", call_due_at: "2026-10-08 10:00:00", journey_state: "reach", match_id: "M1", ...o });
  it("Superbot for a bot source with the HRMS match reference; Vapi (placeVoiceCall) never, also for he rows", async () => {
    h.rows = [callRow({ source_type: "he", meta_lead_id: null })];
    const c = await runCallStep(BOT, "live", NOW, scope(100, ["he"]));
    expect(c.sent).toBe(1);
    expect(h.placeVoice).not.toHaveBeenCalled();
    expect(h.queueSb).toHaveBeenCalledWith(expect.objectContaining({ referenceId: "HRMS-041", mobile10: "9876543210" }));
  });
  it("a source not in the bot list goes to the calling file", async () => {
    h.rows = [callRow({ source_type: "meta_old" })];
    await runCallStep(BOT, "live", NOW, scope(100, ["meta_old"]));
    expect(h.queueSb).not.toHaveBeenCalled();
    expect(find(/SET call_state = 'in_file'/)).toHaveLength(1);
  });
  it("Superbot not configured: calling file", async () => {
    h.sbConfig.mockResolvedValue(null);
    h.rows = [callRow()];
    await runCallStep(BOT, "live", NOW, scope());
    expect(h.queueSb).not.toHaveBeenCalled();
    expect(find(/SET call_state = 'in_file'/)).toHaveLength(1);
  });
});

describe("T9 after two missed calls (Task 10)", () => {
  it("T9 goes once, then stage A ends (reinvite_wait) and the person is released", async () => {
    h.rows = [];
    h.t9 = [row({ wa_status: "sent", call_state: "called", journey_state: "reach", match_id: "M1", missed_call_due_at: "2026-10-08 10:00:00" })];
    const c = await runWhatsappStep(S, "live", NOW, scope());
    expect(h.sendTpl).toHaveBeenCalledTimes(1);
    expect(h.sendTpl.mock.calls[0][0]).toMatchObject({ key: "he_missed_call", matchId: "M1", sentBy: "followup" });
    const end = find(/SET missed_call_due_at = NULL, stage_a_ended_at = \?/)[0];
    expect(end.sql).toContain("journey_state = IF(journey_state IN ('enrolled','reach'), 'reinvite_wait', journey_state)");
    expect(h.release).toHaveBeenCalledWith("9876543210", "F1");
    expect(c.sent).toBe(1);
    const t9sel = find(/qf.missed_call_due_at IS NOT NULL AND qf.missed_call_due_at <= \?/);
    expect(t9sel).toHaveLength(1);
  });
});

describe("re-invite sends are not taken for duplicates of the first invite", () => {
  it("the email and WhatsApp duplicate checks look back 7 days only for a re-invite (>= 7 days after the first contact)", async () => {
    h.rows = [row({ email_status: null, wa_due_at: null, reinvite_no: 1, journey_state: "enrolled", match_id: "M1" })];
    await runEmailStep(S, "live", NOW, scope());
    const dup = find(/FROM he_message WHERE lead_id = \? AND requisition_id = \? AND template_key = \?/)[0];
    expect(dup.sql).toContain("AND created_at >= DATE_SUB(?, INTERVAL 7 DAY)");
    h.sqls = [];
    h.rows = [row({ reinvite_no: 1, journey_state: "reach", match_id: "M1" })];
    await runWhatsappStep(S, "live", NOW, scope());
    const wa = find(/template_key LIKE 'he_walkin_invite:%' OR template_key LIKE 'he_winback:%'/)[0];
    expect(wa.sql).toContain("AND created_at >= DATE_SUB(?, INTERVAL 7 DAY)");
  });
  it("a first invite keeps the all-time duplicate check", async () => {
    h.rows = [row({ email_status: null, wa_due_at: null })];
    await runEmailStep(S, "live", NOW, scope());
    expect(find(/FROM he_message WHERE lead_id = \? AND requisition_id = \? AND template_key = \?/)[0].sql).not.toContain("INTERVAL 7 DAY");
  });
});
