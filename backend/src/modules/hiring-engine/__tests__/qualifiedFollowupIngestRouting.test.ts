import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reply routing for a lead WITH an owned follow-up journey (Task 11). The response writer is mocked
 * away so the pin shows only the ingest's own statements.
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  sends: [] as unknown[],
  emails: [] as unknown[],
  events: [] as unknown[],
  uuid: 0,
  journey: "reach",
  tx: vi.fn(async () => ({ status: "sent" })),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p });
      if (sql.includes("SELECT UUID() AS id")) return [[{ id: `uuid-${++h.uuid}` }]];
      if (sql.includes("WHERE qf.match_id = ?")) return [[{ id: "F1", source_type: "meta_live", he_lead_id: "L1", requisition_id: "R1", mobile10: "9876543210", qualified_at: "2026-10-01 10:00:00", match_id: "M1", journey_state: h.journey, mode_at_enqueue: "live", call_state: "called" }]];
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

vi.mock("../qualified-followup.stageb.js", async (orig) => ({ ...(await orig<typeof import("../qualified-followup.stageb.js")>()), sendTransactionalForJourney: h.tx }));

import { recordInboundReply, recordInviteAnswer, recordVoiceResult } from "../he-ingest.service.js";

const journeyUpdates = () => h.sqls.filter((s) => s.sql.startsWith("UPDATE qualified_followup SET journey_state = ?"));
beforeEach(() => { h.sqls = []; h.sends = []; h.emails = []; h.events = []; h.uuid = 0; h.journey = "reach"; h.tx.mockClear(); process.env.QUAL_FOLLOWUP_MODE = "live"; });
afterEach(() => { delete process.env.QUAL_FOLLOWUP_MODE; });

describe("reply routing for an owned journey", () => {
  it("confirm (email tap) -> T2 through the journey (guarded, once), not the engine path; journey confirmed, stage A over", async () => {
    await recordInviteAnswer("M1", "yes");
    expect(h.tx).toHaveBeenCalledWith(expect.objectContaining({ id: "F1", matchId: "M1" }), "he_walkin_confirmed", expect.anything());
    expect(h.sends).toEqual([]);
    expect(h.emails).toEqual([]);
    expect(journeyUpdates()[0].p).toEqual(["confirmed", "reach", "F1"]);
  });
  it("a reply during stage A ends the cadence (engaged)", async () => {
    await recordInboundReply({ mobile: "919876543210", text: "what is the salary", providerMessageId: "wamid.r.q" });
    expect(journeyUpdates()[0].p).toEqual(["engaged", "reach", "F1"]);
  });
  it("STOP -> T10 through the journey (it passes the opted_out guard) and the journey stops", async () => {
    await recordInboundReply({ mobile: "919876543210", text: "STOP", providerMessageId: "wamid.r.s" });
    expect(h.tx).toHaveBeenCalledWith(expect.objectContaining({ id: "F1" }), "he_optout_ack", expect.anything());
    expect(h.sends).toEqual([]);
    const u = journeyUpdates()[0];
    expect(u.p[0]).toBe("stopped");
    expect(u.sql).toContain("stopped_reason = COALESCE(stopped_reason, 'opted_out')");
  });
  it("two unanswered calls: no engine T9 (the worker sends it once from missed_call_due_at)", async () => {
    await recordVoiceResult({ leadId: "L1", providerCallId: "o-1", result: { answered: false } });
    await recordVoiceResult({ leadId: "L1", providerCallId: "o-2", result: { answered: false } });
    expect(h.sends).toEqual([]);
  });
  it("mode off: today's path, no journey read", async () => {
    delete process.env.QUAL_FOLLOWUP_MODE;
    await recordInviteAnswer("M1", "yes");
    expect(h.sqls.some((s) => s.sql.includes("qf.match_id"))).toBe(false);
    expect(h.sends).toHaveLength(1);
  });
});
