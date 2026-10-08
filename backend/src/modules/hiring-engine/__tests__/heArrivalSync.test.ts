import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Arrival sync and no-show marking (engine tick state hygiene): the SQL each step runs and what it does per row.
 * Sends are paused here so only the hygiene steps (arrival, no-show, stale status) run.
 */
const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  arrivalRows: [] as Array<Record<string, unknown>>,
  noShowRows: [] as Array<Record<string, unknown>>,
  noShowCount: 1,
  affected: 1,
  addEvent: vi.fn(),
  setLeadStatus: vi.fn(),
  recomputeInsight: vi.fn(),
  sendTemplateToLead: vi.fn(async () => ({ status: "sent" })),
  sendFollowUpEmail: vi.fn(async () => ({ status: "sent" })),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, " ").trim();
      h.calls.push([s, params]);
      if (s.includes("JOIN ats_candidate")) return [h.arrivalRows];
      if (s.includes("INTERVAL 120 MINUTE")) return [h.noShowRows];
      if (s.startsWith("SELECT COUNT(*) AS n FROM he_match WHERE lead_id = ?")) return [[{ n: h.noShowCount }]];
      if (s.startsWith("UPDATE")) return [{ affectedRows: h.affected }];
      return [[]];
    }),
    getConnection: vi.fn(async () => { throw new Error("no connection in this test"); }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-lead.service.js", () => ({ addEvent: h.addEvent, setLeadStatus: h.setLeadStatus }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: h.recomputeInsight }));
vi.mock("../he-drive.service.js", () => ({ reserveSlot: vi.fn(), suggestMatches: vi.fn(), createDrive: vi.fn(), setDriveStatus: vi.fn(), lineUpCandidates: vi.fn() }));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: h.sendTemplateToLead, sendsPaused: () => true }));
vi.mock("../he-email.service.js", () => ({ emailConfigured: () => true, sendInviteEmail: vi.fn(), INVITE_EMAIL_KEY: "he_walkin_invite_email" }));
vi.mock("../he-voice.service.js", () => ({ placeVoiceCall: vi.fn() }));
vi.mock("../he-bulk-call.service.js", () => ({ runBulkCallJobs: vi.fn(async () => null) }));
vi.mock("../he-reroute.service.js", () => ({ offerOtherRoles: vi.fn(async () => null) }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false), getDailyPlan: vi.fn(), getPlanMetaOnly: vi.fn(), getPlanRequisitions: vi.fn() }));
vi.mock("../he-plan.service.js", () => ({ planNextDay: vi.fn() }));
vi.mock("../he-meta-bridge.service.js", () => ({ sweepOwnedCampaigns: vi.fn(), bridgeMetaLeads: vi.fn(), bridgeAllMetaLeads: vi.fn() }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: h.sendFollowUpEmail }));
vi.mock("../he-readiness.service.js", () => ({ getRequisitionReadiness: vi.fn(async () => null) }));

import { runEngineTick } from "../he-engine.service.js";

const hygiene = () => h.calls.filter(([s]) => !s.startsWith("SELECT COUNT(*) AS n FROM he_lead l") && !s.startsWith("UPDATE he_lead l"));

beforeEach(() => {
  h.calls.length = 0; h.arrivalRows = []; h.noShowRows = []; h.noShowCount = 1; h.affected = 1;
  for (const f of [h.addEvent, h.setLeadStatus, h.recomputeInsight, h.sendTemplateToLead, h.sendFollowUpEmail]) f.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("arrival sync and no-show marking (pinned before the late-arrival change)", () => {
  it("an invited match with a same-day branch walk-in is marked arrived, with one timeline event", async () => {
    h.arrivalRows = [{ id: "m1", lead_id: "L1", drive_id: "d1", state: "invited" }];
    const s = await runEngineTick({ dryRun: false });
    expect(s.arrivals).toBe(1);
    expect(hygiene()).toMatchSnapshot("sql");
    expect(h.setLeadStatus.mock.calls).toEqual([["L1", "arrived"]]);
    expect(h.addEvent.mock.calls).toEqual([["L1", "arrived", { driveId: "d1", channel: "branch", detail: "registered at branch" }]]);
    expect(h.recomputeInsight.mock.calls).toEqual([["L1"]]);
  });

  it("dry run counts arrivals and writes nothing", async () => {
    h.arrivalRows = [{ id: "m1", lead_id: "L1", drive_id: "d1", state: "confirmed" }];
    const s = await runEngineTick({ dryRun: true });
    expect(s.arrivals).toBe(1);
    expect(h.calls.filter(([sql]) => sql.startsWith("UPDATE he_match"))).toEqual([]);
    expect(h.addEvent).not.toHaveBeenCalled();
  });

  it("a passed slot becomes no_show with one recovery message for a first no-show", async () => {
    h.noShowRows = [{ id: "m2", lead_id: "L2", drive_id: "d2" }];
    const s = await runEngineTick({ dryRun: false });
    expect(s.noShows).toBe(1);
    expect(hygiene()).toMatchSnapshot("sql");
    expect(h.setLeadStatus.mock.calls).toEqual([["L2", "no_show"]]);
    expect(h.addEvent.mock.calls).toEqual([["L2", "no_show", { driveId: "d2", channel: "system" }]]);
    expect(h.sendTemplateToLead.mock.calls).toEqual([[{ leadId: "L2", key: "he_no_show_recovery", matchId: "m2" }]]);
    expect(h.sendFollowUpEmail.mock.calls).toEqual([["no_show", "m2"]]);
  });
});
