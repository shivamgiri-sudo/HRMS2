import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const markCalled = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../qualified-followup.attention.js", () => ({ markFollowupCalled: markCalled }));
vi.mock("../he-superbot.service.js", () => ({ dequeueSuperbotForMatch: vi.fn() }));
vi.mock("../he-master.service.js", () => ({ refreshLeadHistoryById: vi.fn() }));
vi.mock("../he-bot.service.js", () => ({ answerCandidateQuestion: vi.fn(), isLocationTap: vi.fn(), sendLocationLink: vi.fn() }));
vi.mock("../he-lead.service.js", () => ({
  addEvent: vi.fn(), findLeadByMobile: vi.fn(), persistSignals: vi.fn(), revokeConsent: vi.fn(), setLeadStatus: vi.fn(), upsertLead: vi.fn(),
}));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: vi.fn() }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn() }));

import { recordVoiceResult } from "../he-ingest.service.js";

const lead = { id: "lead-1", mobile10: "9876543210", full_name: "A", email: null, status: "contacted", ats_candidate_id: null, meta_lead_id: null };

beforeEach(() => {
  execute.mockReset();
  markCalled.mockReset();
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM he_lead WHERE id")) return [[lead]];
    if (q.includes("provider_call_id = ?")) return [[]];
    if (q.includes("he_match")) return [[]];
    return [[]];
  });
});

describe("recordVoiceResult marks the follow-up row called", () => {
  it("calls markFollowupCalled once with the lead mobile", async () => {
    await recordVoiceResult({ leadId: "lead-1", providerCallId: "pc-1", result: {} as never, incomplete: true } as never);
    expect(markCalled).toHaveBeenCalledTimes(1);
    expect(markCalled).toHaveBeenCalledWith("9876543210");
  });
  it("does not for a duplicate provider call", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM he_lead WHERE id")) return [[lead]];
      if (q.includes("provider_call_id = ?")) return [[{ 1: 1 }]];
      return [[]];
    });
    const out = await recordVoiceResult({ leadId: "lead-1", providerCallId: "pc-1", result: {} as never } as never);
    expect(out?.outcome).toBe("duplicate");
    expect(markCalled).not.toHaveBeenCalled();
  });
  it("a failing mark never fails the result", async () => {
    markCalled.mockRejectedValue(new Error("db down"));
    await expect(recordVoiceResult({ leadId: "lead-1", providerCallId: "pc-2", result: {} as never, incomplete: true } as never)).resolves.toMatchObject({ leadId: "lead-1" });
  });
});
