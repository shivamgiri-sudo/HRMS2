import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every reply, tap and call result writes one response record with the right channel / mode / answer / source. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  responses: [] as Array<Record<string, unknown>>,
  seenMsg: new Set<string>(),
  seenCall: new Set<string>(),
  uuid: 0,
  matchState: "invited",
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql, p });
      if (sql.includes("SELECT UUID() AS id")) return [[{ id: `uuid-${++h.uuid}` }]];
      if (sql.includes("SELECT 1 FROM he_message WHERE provider_message_id = ?")) return [h.seenMsg.has(String(p[0])) ? [{ 1: 1 }] : []];
      if (sql.startsWith("INSERT INTO he_message (id, lead_id, mobile10, direction, channel, body, provider_message_id")) { h.seenMsg.add(String(p[6])); return [{ affectedRows: 1 }]; }
      if (sql.includes("SELECT 1 FROM he_call WHERE provider_call_id = ?")) return [h.seenCall.has(String(p[0])) ? [{ 1: 1 }] : []];
      if (sql.includes("INSERT INTO he_call")) { h.seenCall.add(String(p[2])); return [{ affectedRows: 1 }]; }
      if (sql.includes("FROM he_match WHERE lead_id = ? AND state IN")) return [[{ id: "M1", requisition_id: "R1", drive_id: "D1" }]];
      if (sql.includes("COUNT(*) AS n FROM he_lead_event")) return [[{ n: 0 }]];
      if (sql.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ?")) return [[{ id: "M1", lead_id: "L1", requisition_id: "R1", drive_id: "D1", mobile10: "9876543210", status: "contacted", meta_lead_id: "ML1", state: h.matchState }]];
      if (sql.includes("FROM he_lead WHERE id = ?")) return [[{ id: "L1", mobile10: "9876543210", status: "contacted", meta_lead_id: "ML1" }]];
      if (sql.includes("SELECT state FROM he_match WHERE id = ?")) return [[{ state: "confirmed" }]];
      return [[]];
    }),
    query: vi.fn(),
  },
}));
vi.mock("../he-lead.service.js", () => ({
  addEvent: vi.fn(), setLeadStatus: vi.fn(), revokeConsent: vi.fn(), persistSignals: vi.fn(), upsertLead: vi.fn(),
  findLeadByMobile: vi.fn(async () => ({ id: "L1", mobile10: "9876543210", status: "contacted", meta_lead_id: "ML1" })),
}));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: vi.fn(async () => ({ status: "sent" })) }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn(async () => ({ status: "sent" })) }));
vi.mock("../he-superbot.service.js", () => ({ dequeueSuperbotForMatch: vi.fn() }));
vi.mock("../he-master.service.js", () => ({ refreshLeadHistoryById: vi.fn() }));
vi.mock("../he-bot.service.js", () => ({ answerCandidateQuestion: vi.fn(), isLocationTap: vi.fn(() => false), sendLocationLink: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../qualified-followup.attention.js", () => ({ markFollowupCalled: vi.fn() }));
vi.mock("../candidate-response.service.js", () => ({ recordResponseSafe: vi.fn(async (r: Record<string, unknown>) => { h.responses.push(r); return { id: h.responses.length, created: true, dedupeOf: null, conflict: false }; }) }));
vi.mock("../he-secrets.service.js", () => ({ webhookToken: async () => ({ token: "tok-123", source: "env" }) }));
vi.mock("../he-voice.service.js", () => ({ loadToolResult: vi.fn(), toolNextSlot: vi.fn(), toolReportResult: vi.fn() }));
vi.mock("../he-bulk-call.service.js", () => ({ completeBulkJob: vi.fn() }));
vi.mock("../he-intake.service.js", () => ({ ingestCandidates: vi.fn() }));
vi.mock("../he-call-ref.service.js", () => ({ matchForRef: vi.fn(async () => null) }));

import { recordInboundReply, recordInviteAnswer, recordVoiceResult } from "../he-ingest.service.js";
import { parseWhatsAppWebhook } from "../he-webhook-parse.js";
import { heWebhookRouter } from "../he-webhook.routes.js";

const confirmedVoice = { answered: true, identityConfirmed: "yes" as const, originalSlotAnswer: "yes" as const };
beforeEach(() => { h.sqls = []; h.responses = []; h.seenMsg = new Set(); h.seenCall = new Set(); h.uuid = 0; h.matchState = "invited"; });

describe("invite answers: idempotent, and sends can wait for the lock to be released", () => {
  it("M4: Yes again on an already confirmed match re-sends nothing (no T2, no confirmation email); the tap is recorded unapplied", async () => {
    const { sendTemplateToLead } = await import("../he-send.service.js");
    const { sendFollowUpEmail } = await import("../he-followup-email.service.js");
    vi.mocked(sendTemplateToLead).mockClear(); vi.mocked(sendFollowUpEmail).mockClear();
    h.matchState = "confirmed";
    const r = await recordInviteAnswer("M1", "yes", { channel: "web" });
    expect(r?.state).toBe("confirmed");
    expect(sendTemplateToLead).not.toHaveBeenCalled();
    expect(sendFollowUpEmail).not.toHaveBeenCalled();
    expect(h.sqls.some((s) => s.sql.startsWith("UPDATE he_match SET state"))).toBe(false);
    expect(h.responses.at(-1)).toMatchObject({ answer: "confirm", applied: false });
  });
  it("I-5: with defer, T2 and the confirmation email are queued, not sent, until the caller runs them", async () => {
    const { sendTemplateToLead } = await import("../he-send.service.js");
    const { sendFollowUpEmail } = await import("../he-followup-email.service.js");
    vi.mocked(sendTemplateToLead).mockClear(); vi.mocked(sendFollowUpEmail).mockClear();
    const defer: Array<() => Promise<unknown>> = [];
    await recordInviteAnswer("M1", "yes", { channel: "web", defer });
    expect(h.sqls.some((s) => s.sql.startsWith("UPDATE he_match SET state") && s.p[0] === "confirmed")).toBe(true);
    expect(sendTemplateToLead).not.toHaveBeenCalled();
    expect(sendFollowUpEmail).not.toHaveBeenCalled();
    expect(defer.length).toBeGreaterThan(0);
    for (const f of defer) await f();
    expect(sendTemplateToLead).toHaveBeenCalledWith(expect.objectContaining({ key: "he_walkin_confirmed" }));
    expect(sendFollowUpEmail).toHaveBeenCalledWith("confirmed", "M1");
  });
});

describe("WhatsApp replies", () => {
  it("one response per message with channel / mode / answer / source", async () => {
    await recordInboundReply({ mobile: "919876543210", text: "1", providerMessageId: "wamid.1" });
    expect(h.responses).toHaveLength(1);
    expect(h.responses[0]).toMatchObject({ channel: "whatsapp", mode: "text", answer: "confirm", mobile10: "9876543210", leadId: "L1", matchId: "M1", sourceKind: "he_message", sourceRef: "uuid-1", rawText: "1", applied: true });
  });
  it("Pinbot retry of the same message id → one response", async () => {
    await recordInboundReply({ mobile: "919876543210", text: "1", providerMessageId: "wamid.1" });
    await recordInboundReply({ mobile: "919876543210", text: "1", providerMessageId: "wamid.1" });
    expect(h.responses).toHaveLength(1);
  });
  it("a known button payload decides the answer even when the title text would not", async () => {
    await recordInboundReply({ mobile: "919876543210", text: "Theek hai sir", providerMessageId: "wamid.2", buttonId: "yes" });
    expect(h.responses[0]).toMatchObject({ mode: "button", answer: "confirm", applied: true });
    expect(h.sqls.find((s) => s.sql.startsWith("UPDATE he_match SET state"))!.p).toEqual(["confirmed", "M1"]);
    expect(h.sqls.find((s) => s.sql.startsWith("INSERT INTO he_message (id, lead_id, mobile10, direction, channel, body, provider_message_id"))!.p).toContain("confirm");
  });
  it("an unknown button payload falls back to the text", async () => {
    await recordInboundReply({ mobile: "919876543210", text: "Cannot come", providerMessageId: "wamid.3", buttonId: "btn_77" });
    expect(h.responses[0]).toMatchObject({ mode: "text", answer: "decline" });
  });
  it("free text question → answer question, not applied, no state change", async () => {
    await recordInboundReply({ mobile: "919876543210", text: "what is the salary", providerMessageId: "wamid.4" });
    expect(h.responses[0]).toMatchObject({ answer: "question", applied: false, suggested: { answer: "question", confidence: 0.8 } });
    expect(h.sqls.some((s) => s.sql.startsWith("UPDATE he_match SET state"))).toBe(false);
  });
  it("the in-row he_message now carries requisition_id and drive_id of the active match", async () => {
    await recordInboundReply({ mobile: "919876543210", text: "kal", providerMessageId: "wamid.5" });
    const ins = h.sqls.find((s) => s.sql.startsWith("INSERT INTO he_message (id, lead_id, mobile10, direction, channel, body, provider_message_id"))!;
    expect(ins.sql).toContain("requisition_id, drive_id");
    expect(ins.p.slice(-2)).toEqual(["R1", "D1"]);
  });
  it("the webhook passes the button payload id", async () => {
    const r = parseWhatsAppWebhook({ messages: [
      { from: "91", id: "a", button: { text: "Haan ji", payload: "1" } },
      { from: "91", id: "b", interactive: { button_reply: { id: "later", title: "Another time" } } },
      { from: "91", id: "c", text: { body: "ok" } },
    ] });
    expect(r.inbound.map((m) => m.buttonId ?? null)).toEqual(["1", "later", null]);
  });
});

describe("taps", () => {
  it("web tap → web / button / public_answer keyed on the in-row message", async () => {
    await recordInviteAnswer("M1", "yes");
    expect(h.responses).toEqual([expect.objectContaining({ channel: "web", mode: "button", answer: "confirm", matchId: "M1", sourceKind: "public_answer", sourceRef: "uuid-1", applied: true })]);
  });
  it("HR answer → hr / manual with the actor and the invite", async () => {
    await recordInviteAnswer("M1", "no", { channel: "hr", actor: "U1", inviteId: "I1" });
    expect(h.responses[0]).toMatchObject({ channel: "hr", mode: "manual", answer: "decline", sourceKind: "hr_action", handledBy: "U1", inviteId: "I1" });
  });
  it("the he_message in-row keeps channel email (unchanged)", async () => {
    await recordInviteAnswer("M1", "later");
    expect(h.sqls.find((s) => s.sql.startsWith("INSERT INTO he_message"))!.p[4]).toBe("email");
  });
});

describe("calls", () => {
  it("Superbot report → voice_bot / call / superbot_report keyed on the call id", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "sb-1", result: confirmedVoice, source: "superbot_report" });
    expect(h.responses[0]).toMatchObject({ channel: "voice_bot", mode: "call", answer: "confirm", sourceKind: "superbot_report", sourceRef: "sb-1", matchId: "M1", applied: true });
  });
  it("Superbot report imported twice → one response", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "sb-1", result: confirmedVoice, source: "superbot_report" });
    await recordVoiceResult({ leadId: "L1", providerCallId: "sb-1", result: confirmedVoice, source: "superbot_report" });
    expect(h.responses).toHaveLength(1);
  });
  it("call file import → call_file channel", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "imp:1", result: { answered: false }, source: "call_import" });
    expect(h.responses[0]).toMatchObject({ channel: "call_file", answer: "no_answer", sourceKind: "call_import" });
  });
  it("an incomplete call is recorded as no_answer", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "sb-9", result: { answered: true, identityConfirmed: "yes" }, incomplete: true, source: "superbot_hook" });
    expect(h.responses[0]).toMatchObject({ answer: "no_answer", sourceKind: "superbot_hook", applied: false });
  });
  it("he_call carries requisition_id / drive_id of the match", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "sb-2", result: confirmedVoice });
    const ins = h.sqls.find((s) => s.sql.includes("INSERT INTO he_call"))!;
    expect(ins.sql).toMatch(/requisition_id, drive_id\)/);
    expect(ins.p.slice(-2)).toEqual(["R1", "D1"]);
    expect(h.responses[0]).toMatchObject({ sourceKind: "voice_hook" });
  });
});

describe("webhook source kinds", () => {
  const app = express(); app.use(express.json()); app.use("/api/he-hook", heWebhookRouter);
  it("/voice records source voice_hook; /superbot superbot_hook", async () => {
    await request(app).post("/api/he-hook/voice?token=tok-123").send({ leadId: "L1", providerCallId: "v-1", result: confirmedVoice });
    await request(app).post("/api/he-hook/superbot?token=tok-123").send({ phone: "919876543210", reference_id: "HRMS-1", call_id: "s-1", disposition: "Interested", call_status: "answered" });
    expect(h.responses.map((r) => r.sourceKind)).toEqual(expect.arrayContaining(["voice_hook", "superbot_hook"]));
  });
  it("/whatsapp passes the button id through", async () => {
    await request(app).post("/api/he-hook/whatsapp?token=tok-123").send({ messages: [{ from: "919876543210", id: "wamid.9", button: { text: "Haan ji", payload: "3" } }] });
    expect(h.responses[0]).toMatchObject({ mode: "button", answer: "decline" });
  });
});
