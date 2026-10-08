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

import { runEngineTick, runFollowUps } from "../he-engine.service.js";
import { countedNoShow } from "../he-no-show-events.js";

const hygiene = () => h.calls.filter(([s]) => !s.startsWith("SELECT COUNT(*) AS n FROM he_lead l") && !s.startsWith("UPDATE he_lead l"));

beforeEach(() => {
  h.calls.length = 0; h.arrivalRows = []; h.noShowRows = []; h.noShowCount = 1; h.affected = 1;
  for (const f of [h.addEvent, h.setLeadStatus, h.recomputeInsight, h.sendTemplateToLead, h.sendFollowUpEmail]) f.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("arrival sync and no-show marking (pinned before the late-arrival change; arrival statements updated by it)", () => {
  it("an invited match with a same-day branch walk-in is marked arrived, with one timeline event", async () => {
    h.arrivalRows = [{ id: "m1", lead_id: "L1", drive_id: "d1", state: "invited" }];
    const s = await runEngineTick({ dryRun: false });
    expect(s.arrivals).toBe(1);
    expect(hygiene()).toMatchSnapshot("sql");
    // Was setLeadStatus(L1, arrived); now a guarded UPDATE (in the sql snapshot) that never overwrites an opt-out or a join.
    expect(h.setLeadStatus).not.toHaveBeenCalled();
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

describe("late and unplanned walk-ins are recorded as arrivals", () => {
  const arrivalSql = () => h.calls.find(([s]) => s.includes("JOIN ats_candidate"))![0];
  const lead = () => h.calls.filter(([s]) => s.startsWith("UPDATE he_lead SET"));

  it("reads same-day walk-ins for booked, no-show, suggested and released matches, never selected / arrived / declined", async () => {
    await runEngineTick({ dryRun: true });
    const s = arrivalSql();
    expect(s).toContain("m.state IN ('invited','confirmed')");
    expect(s).toContain("m.state IN ('no_show','suggested','slot_released')");
    // the match's own states (the same-day NOT EXISTS over other matches may name them)
    expect(s.slice(0, s.indexOf("NOT EXISTS"))).not.toMatch(/'selected'|'arrived'|'declined'/);
    expect(s).toContain("x.walk_in_date = CURDATE()");
    expect(s).toContain("d.drive_date = CURDATE()");
    // A match that was not booked for this drive needs the walk-in at the drive's branch (when the form names one).
    expect(s).toContain("(c.applied_for_branch IS NULL OR c.applied_for_branch = d.branch_name)");
    // From today's drives by key; the phone pass reads the covering (mobile, walk_in_date) index only.
    expect(s).toMatch(/^SELECT \/\*\+ NO_MERGE\(w\) \*\/ DISTINCT STRAIGHT_JOIN .* FROM he_drive d JOIN he_match m ON m.drive_id = d.id /);
  });

  it("a no_show who registers at the branch later that day becomes arrived, keeps an opt-out, and gets no recovery message", async () => {
    h.arrivalRows = [{ id: "m3", lead_id: "L3", drive_id: "d3", state: "no_show" }];
    const s = await runEngineTick({ dryRun: false });
    expect(s.arrivals).toBe(1);
    const upd = h.calls.find(([q]) => q.startsWith("UPDATE he_match SET state = 'arrived'"))!;
    expect(upd).toEqual(["UPDATE he_match SET state = 'arrived' WHERE id = ? AND state IN ('invited','confirmed','no_show','suggested','slot_released')", ["m3"]]);
    expect(lead()).toEqual([["UPDATE he_lead SET status = 'arrived', status_at = NOW() WHERE id = ? AND status NOT IN ('opted_out','joined')", ["L3"]]]);
    expect(h.setLeadStatus).not.toHaveBeenCalled();
    expect(h.addEvent.mock.calls).toEqual([["L3", "arrived", { driveId: "d3", channel: "branch", detail: "registered at branch after being marked no-show", meta: { from: "no_show" } }]]);
    expect(h.recomputeInsight.mock.calls).toEqual([["L3"]]);
    expect(h.sendTemplateToLead).not.toHaveBeenCalled();
    expect(h.sendFollowUpEmail).not.toHaveBeenCalled();
  });

  it("suggested and slot_released walk-ins are arrivals with the earlier state on the event", async () => {
    h.arrivalRows = [{ id: "m4", lead_id: "L4", drive_id: "d4", state: "suggested" }, { id: "m5", lead_id: "L5", drive_id: "d4", state: "slot_released" }];
    const s = await runEngineTick({ dryRun: false });
    expect(s.arrivals).toBe(2);
    expect(h.addEvent.mock.calls).toEqual([
      ["L4", "arrived", { driveId: "d4", channel: "branch", detail: "walked in without a booking", meta: { from: "suggested" } }],
      ["L5", "arrived", { driveId: "d4", channel: "branch", detail: "registered at branch", meta: { from: "slot_released" } }],
    ]);
  });

  it("is idempotent: a match whose state moved on meanwhile (selected, already arrived) is not touched and not counted", async () => {
    h.arrivalRows = [{ id: "m6", lead_id: "L6", drive_id: "d6", state: "no_show" }];
    h.affected = 0;
    const s = await runEngineTick({ dryRun: false });
    expect(s.arrivals).toBe(0);
    expect(lead()).toEqual([]);
    expect(h.addEvent).not.toHaveBeenCalled();
    expect(h.recomputeInsight).not.toHaveBeenCalled();
  });
});

describe("a no-show event corrected by an arrival at the same drive is not counted", () => {
  it("countedNoShow excludes no_show events with an arrived event for the same lead and drive (idx_he_event_drive)", () => {
    expect(countedNoShow("e")).toBe("e.event_type = 'no_show' AND NOT EXISTS (SELECT 1 FROM he_lead_event ax WHERE ax.drive_id = e.drive_id AND ax.event_type = 'arrived' AND ax.lead_id = e.lead_id)");
  });
});

describe("runFollowUps state hygiene (pinned before arrival sync was added to it)", () => {
  it("sends paused: only the no-show pass runs", async () => {
    h.noShowRows = [{ id: "m2", lead_id: "L2", drive_id: "d2" }];
    const r = await runFollowUps({ dryRun: false });
    expect(r.noShows).toBe(1);
    expect(h.calls).toMatchSnapshot("sql");
  });
});

describe("one walk-in credits at most one same-day match", () => {
  const arrivalSql = () => h.calls.find(([s]) => s.includes("JOIN ats_candidate"))![0];

  it("late states need the walk-in's requisition (when the form names one) and no better same-day match of the lead", async () => {
    await runEngineTick({ dryRun: true });
    const s = arrivalSql();
    const late = s.slice(s.indexOf("m.state IN ('no_show','suggested','slot_released')"));
    expect(late).toContain("(c.applied_for_branch IS NULL OR c.applied_for_branch = d.branch_name)");
    expect(late).toContain("(c.requisition_id IS NULL OR c.requisition_id = m.requisition_id)");
    // Another same-day match that is booked / arrived / selected anywhere wins: the walk-in belongs to that booking, and a no_show of
    // the booked requisition is not blocked by a merely suggested one (suggested ranks below no_show).
    expect(late).toContain("NOT EXISTS (SELECT 1 FROM he_match m2 JOIN he_drive d2 ON d2.id = m2.drive_id AND d2.drive_date = CURDATE() WHERE m2.lead_id = m.lead_id AND m2.id <> m.id AND (m2.state IN ('invited','confirmed','arrived','selected')");
    // Among late matches at the same branch that the walk-in's requisition allows: no_show, then slot_released, then suggested, then lowest id.
    expect(late).toContain("OR (d2.branch_name = d.branch_name AND m2.state IN ('no_show','suggested','slot_released') AND (c.requisition_id IS NULL OR c.requisition_id = m2.requisition_id) AND (FIELD(m2.state, 'no_show','slot_released','suggested') < FIELD(m.state, 'no_show','slot_released','suggested') OR (m2.state = m.state AND m2.id < m.id)))))");
    // booked states keep the old rule (no extra conditions before the OR)
    expect(s).toContain("AND (m.state IN ('invited','confirmed') OR (m.state IN ('no_show','suggested','slot_released') AND");
  });
});

describe("runFollowUps records arrivals before marking no-shows", () => {
  it("arrival sync runs first, so a same-day walk-in is arrived before the no-show pass and gets no T6", async () => {
    h.arrivalRows = [{ id: "m1", lead_id: "L1", drive_id: "d1", state: "invited" }];
    const r = await runFollowUps({ dryRun: false });
    expect(r.arrivals).toBe(1);
    const order = h.calls.map(([q]) => (q.includes("JOIN ats_candidate") ? "arrival" : q.includes("INTERVAL 120 MINUTE") ? "noshow" : null)).filter(Boolean);
    expect(order).toEqual(["arrival", "noshow"]);
  });
  it("dry run counts and writes nothing", async () => {
    h.arrivalRows = [{ id: "m1", lead_id: "L1", drive_id: "d1", state: "invited" }];
    const r = await runFollowUps({ dryRun: true });
    expect(r.arrivals).toBe(1);
    expect(h.calls.filter(([q]) => q.startsWith("UPDATE"))).toEqual([]);
  });
});
