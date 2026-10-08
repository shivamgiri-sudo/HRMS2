import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ responses: [] as Array<Record<string, unknown>>, phone: "+91 98765 43210" as string | null }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => (sql.includes("FROM meta_lead_raw WHERE id = ?") ? [h.phone == null ? [] : [{ parsed_phone: h.phone }]] : [[]])) },
}));
vi.mock("../../hiring-engine/candidate-response.service.js", () => ({
  recordResponseSafe: vi.fn(async (r: Record<string, unknown>) => { h.responses.push(r); return { id: 1, created: true, dedupeOf: null, conflict: false }; }),
}));

import { answerFromMetaVoice, recordMetaVoiceResponse } from "../meta-response-bridge.service.js";

const at = new Date("2026-10-08T06:00:00Z");
beforeEach(() => { h.responses = []; h.phone = "+91 98765 43210"; });

describe("Meta voice responses", () => {
  it.each([
    ["completed_not_interested", "decline"], ["not_interested", "decline"], ["no_answer", "no_answer"], ["busy", "no_answer"], ["failed", "no_answer"],
    ["completed_interested", "other"], ["completed", "other"], ["", "other"],
  ])("status %s → %s", (s, a) => expect(answerFromMetaVoice(s)).toBe(a));

  it("Vapi: one response keyed on the call id, voice_bot / call, for HR review when it is a decline", async () => {
    await recordMetaVoiceResponse({ metaLeadId: "ML1", status: "completed_not_interested", outcome: "not_interested: no", callId: "vapi-1", source: "vapi", at });
    expect(h.responses).toEqual([expect.objectContaining({ channel: "voice_bot", mode: "call", answer: "decline", status: "needs_review", mobile10: "9876543210", metaLeadId: "ML1", sourceKind: "vapi", sourceRef: "vapi-1", applied: false })]);
  });

  it("no call id → keyed on lead + status + IST day, so a provider retry is one row", async () => {
    await recordMetaVoiceResponse({ metaLeadId: "ML1", status: "no_answer", outcome: null, callId: null, source: "meta_voice", at });
    expect(h.responses[0]).toMatchObject({ sourceKind: "meta_voice", sourceRef: "meta:ML1:no_answer:2026-10-08", answer: "no_answer", status: "recorded" });
  });

  it("no usable phone → nothing recorded", async () => {
    h.phone = null;
    await recordMetaVoiceResponse({ metaLeadId: "ML1", status: "busy", outcome: null, callId: "x", source: "vapi", at });
    h.phone = "12345";
    await recordMetaVoiceResponse({ metaLeadId: "ML1", status: "busy", outcome: null, callId: "x", source: "vapi", at });
    expect(h.responses).toHaveLength(0);
  });
});
