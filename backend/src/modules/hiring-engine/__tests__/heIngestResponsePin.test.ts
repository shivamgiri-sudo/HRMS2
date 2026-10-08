import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pin of reply, tap and voice ingest (SQL + sends) taken before response capture was added. The response writer itself is mocked
 * away so the pin shows only the ingest's own statements.
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  sends: [] as unknown[],
  emails: [] as unknown[],
  events: [] as unknown[],
  uuid: 0,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p });
      if (sql.includes("SELECT UUID() AS id")) return [[{ id: `uuid-${++h.uuid}` }]];
      if (sql.includes("FROM he_match WHERE lead_id = ? AND state IN")) return [[{ id: "M1", requisition_id: "R1", drive_id: "D1" }]];
      if (sql.includes("COUNT(*) AS n FROM he_lead_event")) return [[{ n: 0 }]];
      if (sql.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ?")) return [[{ id: "M1", lead_id: "L1", requisition_id: "R1", drive_id: "D1", mobile10: "9876543210", status: "contacted", meta_lead_id: "ML1" }]];
      if (sql.includes("FROM he_lead WHERE id = ?")) return [[{ id: "L1", mobile10: "9876543210", status: "contacted", meta_lead_id: "ML1" }]];
      if (sql.includes("SELECT id FROM he_message WHERE lead_id = ? AND direction = 'out'")) return [[{ id: "OUT1" }]];
      if (sql.includes("SELECT state FROM he_match WHERE id = ?")) return [[{ state: "confirmed" }]];
      return [[]];
    }),
  },
}));
vi.mock("../he-lead.service.js", () => ({
  addEvent: vi.fn(async (...a: unknown[]) => { h.events.push(a); }),
  setLeadStatus: vi.fn(), revokeConsent: vi.fn(), persistSignals: vi.fn(),
  findLeadByMobile: vi.fn(async () => ({ id: "L1", mobile10: "9876543210", status: "contacted", meta_lead_id: "ML1" })),
  upsertLead: vi.fn(),
}));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: vi.fn(async (a: unknown) => { h.sends.push(a); return { status: "sent" }; }) }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn(async (...a: unknown[]) => { h.emails.push(a); return { status: "sent" }; }) }));
vi.mock("../he-superbot.service.js", () => ({ dequeueSuperbotForMatch: vi.fn() }));
vi.mock("../he-master.service.js", () => ({ refreshLeadHistoryById: vi.fn() }));
vi.mock("../he-bot.service.js", () => ({ answerCandidateQuestion: vi.fn(), isLocationTap: vi.fn(() => false), sendLocationLink: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../qualified-followup.attention.js", () => ({ markFollowupCalled: vi.fn() }));
vi.mock("../candidate-response.service.js", () => ({ recordResponseSafe: vi.fn(async () => ({ id: 1, created: true, dedupeOf: null, conflict: false })) }));

import { recordInboundReply, recordInviteAnswer, recordVoiceResult } from "../he-ingest.service.js";

const snap = () => ({ sqls: h.sqls, sends: h.sends, emails: h.emails, events: h.events });
beforeEach(() => { h.sqls = []; h.sends = []; h.emails = []; h.events = []; h.uuid = 0; });

describe("ingest pin", () => {
  for (const text of ["1", "kal", "STOP", "what is the salary"]) {
    it(`WhatsApp "${text}"`, async () => {
      await recordInboundReply({ mobile: "919876543210", text, providerMessageId: `wamid.${text}` });
      expect(snap()).toMatchSnapshot();
    });
  }
  for (const a of ["yes", "no", "later"] as const) {
    it(`tap ${a}`, async () => {
      await recordInviteAnswer("M1", a);
      expect(snap()).toMatchSnapshot();
    });
  }
  it("Superbot confirmed", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "sb-1", result: { answered: true, identityConfirmed: "yes", originalSlotAnswer: "yes" } });
    expect(snap()).toMatchSnapshot();
  });
  it("Superbot no answer", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "sb-2", result: { answered: false } });
    expect(snap()).toMatchSnapshot();
  });
  it("call file import confirmed", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "imp:abc", startedAt: "2026-10-08 11:00:00", result: { answered: true, identityConfirmed: "yes", originalSlotAnswer: "yes" }, confirmedSlotAt: "2026-10-09 11:00:00" });
    expect(snap()).toMatchSnapshot();
  });
});
