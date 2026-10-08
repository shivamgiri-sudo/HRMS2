import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The engine tick's 5-minute re-line-up (driveInvites) for drives no stream feeds: the exact SQL, parameters, order and
 * suggestMatches calls before streams existed. Statements naming a requisition_stream* table are filtered out. Never update this snapshot.
 */
const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  suggestMatches: vi.fn(async () => 3),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.calls.push([sql.replace(/\s+/g, " ").trim(), params]);
      if (sql.includes("SELECT id FROM he_drive WHERE status = 'active' AND auto_send = 1")) return [[{ id: "d1" }, { id: "d2" }]];
      if (sql.includes("COUNT(*) AS n FROM he_template")) return [[{ n: 1 }]];
      return [[]];
    }),
    getConnection: vi.fn(async () => { throw new Error("no connection in this test"); }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), setLeadStatus: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../he-drive.service.js", () => ({ reserveSlot: vi.fn(async () => "slot"), suggestMatches: h.suggestMatches, createDrive: vi.fn(), setDriveStatus: vi.fn(), lineUpCandidates: vi.fn() }));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: vi.fn(async () => ({ status: "sent" })), sendsPaused: () => false }));
vi.mock("../he-email.service.js", () => ({ emailConfigured: () => true, sendInviteEmail: vi.fn(async () => ({ status: "sent" })), INVITE_EMAIL_KEY: "he_walkin_invite_email" }));
vi.mock("../he-voice.service.js", () => ({ placeVoiceCall: vi.fn() }));
vi.mock("../he-bulk-call.service.js", () => ({ runBulkCallJobs: vi.fn(async () => null) }));
vi.mock("../he-reroute.service.js", () => ({ offerOtherRoles: vi.fn(async () => null) }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false), getDailyPlan: vi.fn(), getPlanMetaOnly: vi.fn(), getPlanRequisitions: vi.fn() }));
vi.mock("../he-plan.service.js", () => ({ planNextDay: vi.fn() }));
vi.mock("../he-meta-bridge.service.js", () => ({ sweepOwnedCampaigns: vi.fn(async () => ({ poolRows: 0, linked: 0 })), bridgeMetaLeads: vi.fn(), bridgeAllMetaLeads: vi.fn() }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn(async () => ({ status: "skipped" })) }));
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: vi.fn(async () => null) }));

import { runEngineTick } from "../he-engine.service.js";

const legacyCalls = () => h.calls.filter(([sql]) => !sql.includes("requisition_stream"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30"));
  h.calls.length = 0;
  h.suggestMatches.mockClear();
  delete process.env.QUAL_FOLLOWUP_MODE;
});
afterEach(() => { vi.useRealTimers(); });

describe("engine re-line-up before streams (snapshot of today's behaviour)", () => {
  it("live tick: every active auto-send drive is re-lined with suggestMatches", async () => {
    await runEngineTick({ dryRun: false });
    expect(h.suggestMatches.mock.calls).toEqual([["d1"], ["d2"]]);
    expect(legacyCalls()).toMatchSnapshot("sql");
  });

  it("dry-run tick re-lines nothing", async () => {
    await runEngineTick({ dryRun: true });
    expect(h.suggestMatches).not.toHaveBeenCalled();
    expect(legacyCalls()).toMatchSnapshot("sql");
  });
});
