import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Double-send prevention in the three existing senders (old Meta flow, Meta sync, Hiring Engine). With QUAL_FOLLOWUP_MODE unset / dry_run /
 * live + test flag every sender behaves as before; only live (not test) with an OPEN enrolled row makes them step aside. STOP is honoured always.
 */
const h = vi.hoisted(() => ({
  state: { enrolled: false, liveRow: "none" as string, hasLiveThrows: false, enrollThrows: false, optedOut: false, optedOutThrows: false, matches: [] as any[], enrolledLeads: new Set<string>() },
  sqls: [] as string[],
  sendTemplate: vi.fn(async (..._a: unknown[]) => ({ success: true })),
  emailSend: vi.fn(async (..._a: unknown[]) => undefined),
  enqueue: vi.fn(async (..._a: unknown[]) => ({ status: "enqueued" as string })),
  sendInviteEmail: vi.fn(async (..._a: unknown[]) => ({ status: "sent" })),
  sendTemplateToLead: vi.fn(async (..._a: unknown[]) => ({ status: "sent" })),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, _p?: unknown[]) => {
      h.sqls.push(sql);
      if (sql.includes("FROM meta_lead_raw ml")) {
        return [[{ id: "L1", parsed_name: "Asha Rao", parsed_phone: "9876543210", parsed_email: "a@x.in", screening_result: "qualified", notification_sent_at: null,
          designation_name: "CSE", branch_name: "Noida", requisition_code: "R1", bmi_assessment_url: "https://bmi.test/x", salary_min: null, salary_max: null,
          approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, parsed_location: "Noida",
          current_address: null, permanent_address: null, branch_state: "UP", branch_address: "Sector 62, Noida", branch_city: "Noida", branch_lat: null, branch_lng: null }]];
      }
      if (sql.includes("qualified_followup qf") && sql.includes("FROM meta_lead_raw r") && !sql.includes("stopped_reason IS NULL")) {
        if (h.state.hasLiveThrows) throw new Error("db down");
        return [h.state.liveRow === "live" ? [{ hit: 1 }] : []];
      }
      if (sql.includes("qualified_followup qf") && sql.includes("FROM meta_lead_raw r")) {
        if (h.state.enrollThrows) throw new Error("db down");
        return [h.state.enrolled ? [{ hit: 1 }] : []];
      }
      if (sql.includes("FROM he_lead l") && sql.includes("l.mobile10 = ?") && sql.includes("opted_out")) {
        if (h.state.optedOutThrows) throw new Error("db down");
        return [h.state.optedOut ? [{ hit: 1 }] : []];
      }
      if (sql.trim().startsWith("SELECT id") && sql.includes("FROM meta_lead_raw") && sql.includes("notification_sent_at IS NULL")) return [sql.includes("HAVING (auto_notify_off = 1") ? [] : [{ id: "L1" }, { id: "L2" }]];
      if (sql.includes("COUNT(*) AS n FROM he_template")) return [[{ n: 1 }]];
      if (sql.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id")) {
        const filtered = sql.includes("NOT EXISTS (SELECT 1 FROM qualified_followup qf");
        return [h.state.matches.filter((m) => !(filtered && h.state.enrolledLeads.has(m.lead_id)))];
      }
      if (sql.includes("SELECT * FROM meta_lead_raw WHERE id")) return [[{ id: "N1", meta_form_id: "f", meta_lead_id: "g", screening_result: "qualified", raw_payload: "{}", created_at: new Date() }]];
      if (sql.includes("FROM meta_campaign mc")) return [[{ id: "c1", requisition_id: "r1", meta_screening_config: null }]];
      return [[]];
    }),
  },
}));
vi.mock("../../communication/providers/provider.factory.js", () => ({ providerFactory: { getProviderAsync: vi.fn() } }));
vi.mock("../../communication/provider-config.service.js", () => ({ providerConfigService: { loadActiveConfig: vi.fn() } }));
vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({
  PinbotWhatsAppProvider: class { isConfigured() { return true; } sendTemplate(...a: unknown[]) { return h.sendTemplate(...a); } },
}));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: h.emailSend } }));
vi.mock("../../meta-campaign/voicebot.provider.js", () => ({ triggerVoiceCall: vi.fn(), isVoicebotConfigured: () => false }));
vi.mock("../../meta-campaign/vapi-voicebot.provider.js", () => ({ triggerVapiCallWithInlineScript: vi.fn(), isVapiConfigured: () => false }));
vi.mock("../../meta-campaign/meta-messages.service.js", () => ({ saveMessage: vi.fn(), reconcileDeliveryStatuses: vi.fn(async () => ({ checked: 0 })) }));
vi.mock("../../meta-campaign/interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn(async () => ({ dateLabel: "Thu 8 Oct", timeLabel: "11:00 AM" })) }));
vi.mock("../he-campaign-config.service.js", () => ({ metaOutreachBlockedByEngine: vi.fn(async () => null), heOwnsCampaign: vi.fn(async () => false) }));
vi.mock("../qualified-followup.service.js", async () => {
  const actual = await vi.importActual<typeof import("../qualified-followup.service.js")>("../qualified-followup.service.js");
  return { ...actual, enqueueMetaLeadFollowup: h.enqueue };
});
vi.mock("../../meta-campaign/lead-outreach.service.js", async () => {
  const actual = await vi.importActual<typeof import("../../meta-campaign/lead-outreach.service.js")>("../../meta-campaign/lead-outreach.service.js");
  return { ...actual, notifyQualifiedLead: vi.fn((...a: Parameters<typeof actual.notifyQualifiedLead>) => actual.notifyQualifiedLead(...a)) };
});
vi.mock("../../meta-campaign/lead-screener.service.js", async () => {
  const actual = await vi.importActual<typeof import("../../meta-campaign/lead-screener.service.js")>("../../meta-campaign/lead-screener.service.js");
  return { ...actual, screenLead: vi.fn(() => ({ qualified: true, reason: null })) };
});
vi.mock("../../meta-campaign/campaign-screening.js", () => ({ loadCampaignScreeningConfig: vi.fn(async () => null) }));
vi.mock("../../meta-campaign/meta-lead.parser.js", async () => {
  const actual = await vi.importActual<typeof import("../../meta-campaign/meta-lead.parser.js")>("../../meta-campaign/meta-lead.parser.js");
  return { ...actual, parseLead: vi.fn(() => ({ routingCode: null, name: "A B", phone: "9876543210", email: null, age: null, location: null, education: null, experienceYears: null, gender: null, rawFields: {} })) };
});
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: vi.fn(), sweepOwnedCampaigns: vi.fn() }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), setLeadStatus: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../he-drive.service.js", () => ({ reserveSlot: vi.fn(async () => "slot"), suggestMatches: vi.fn() }));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: h.sendTemplateToLead, sendsPaused: () => false }));
vi.mock("../he-email.service.js", () => ({ emailConfigured: () => true, sendInviteEmail: h.sendInviteEmail, INVITE_EMAIL_KEY: "he_walkin_invite_email" }));
vi.mock("../he-voice.service.js", () => ({ placeVoiceCall: vi.fn() }));
vi.mock("../he-bulk-call.service.js", () => ({ runBulkCallJobs: vi.fn() }));
vi.mock("../he-reroute.service.js", () => ({ offerOtherRoles: vi.fn(async () => null) }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false) }));
vi.mock("../he-plan.service.js", () => ({ planNextDay: vi.fn() }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn(async () => ({ status: "skipped" })) }));

import { notifyQualifiedLead } from "../../meta-campaign/lead-outreach.service.js";
import { metaCampaignService } from "../../meta-campaign/meta-campaign.service.js";
import { notifyNewQualifiedLeads } from "../../../cron/metaLeadSync.cron.js";
import { inviteForDrive, runFollowUps } from "../he-engine.service.js";
import { followupEnrolled } from "../qualified-followup.service.js";

type Env = Record<string, string | undefined>;
const MODES: Array<{ name: string; env: Env; owns: boolean }> = [
  { name: "unset", env: {}, owns: false },
  { name: "off", env: { QUAL_FOLLOWUP_MODE: "off" }, owns: false },
  { name: "dry_run", env: { QUAL_FOLLOWUP_MODE: "dry_run" }, owns: false },
  { name: "live + test flag", env: { QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true" }, owns: false },
  { name: "live", env: { QUAL_FOLLOWUP_MODE: "live" }, owns: true },
];
const KEYS = ["QUAL_FOLLOWUP_MODE", "QUAL_FOLLOWUP_TEST_MODE"];
const setEnv = (e: Env) => { for (const k of KEYS) delete process.env[k]; for (const [k, v] of Object.entries(e)) if (v !== undefined) process.env[k] = v; };
const followupSql = () => h.sqls.filter((s) => s.includes("qualified_followup"));
const twoMatches = () => [
  { id: "m1", lead_id: "enrolled", full_name: "E One", mobile10: "9876543210", dormant: 0, has_email: 1, email_on: 1, whatsapp_on: 1, has_consent: 1 },
  { id: "m2", lead_id: "free", full_name: "F Two", mobile10: "9876543211", dormant: 0, has_email: 1, email_on: 1, whatsapp_on: 1, has_consent: 1 },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T12:00:00+05:30"));
  vi.clearAllMocks();
  h.sqls.length = 0;
  Object.assign(h.state, { enrolled: false, liveRow: "none", hasLiveThrows: false, enrollThrows: false, optedOut: false, optedOutThrows: false, matches: twoMatches(), enrolledLeads: new Set<string>() });
  h.enqueue.mockResolvedValue({ status: "enqueued" });
  setEnv({});
});
afterEach(() => { vi.useRealTimers(); setEnv({}); });

describe.each(MODES)("mode $name", ({ env, owns }) => {
  describe.each([{ enrolled: true }, { enrolled: false }])("lead enrolled=$enrolled", ({ enrolled }) => {
    const steps = enrolled && owns; // the only combination where the senders step aside
    beforeEach(() => { setEnv(env); h.state.enrolled = enrolled; h.state.enrolledLeads = new Set(enrolled ? ["enrolled"] : []); });

    // Unified method (Task 14): the env alone never makes the legacy path step aside (no screen switch here); only a person the method
    // owns (a live / canary row, open or stopped) is skipped, in every mode, force or not.
    it("notifyQualifiedLead", async () => {
      h.state.liveRow = enrolled ? "live" : "none";
      const out = await notifyQualifiedLead("L1");
      if (enrolled) {
        expect(out.skipped).toEqual([{ channel: "all", reason: "Handled by the follow-up method" }]);
        expect(out.attempted).toEqual([]);
        const forced = await notifyQualifiedLead("L1", { force: true });
        expect(forced.skipped).toEqual([{ channel: "all", reason: "Handled by the follow-up method" }]);
        expect(h.sendTemplate).not.toHaveBeenCalled();
        expect(h.emailSend).not.toHaveBeenCalled();
      } else {
        expect(out.succeeded).toEqual(expect.arrayContaining(["whatsapp", "email"]));
        expect(h.sendTemplate).toHaveBeenCalledTimes(1);
        expect(h.emailSend).toHaveBeenCalledTimes(1);
      }
    });

    it("notifyNewQualifiedLeads (sync)", async () => {
      h.state.liveRow = enrolled ? "live" : "none";
      const res = await notifyNewQualifiedLeads();
      expect(h.enqueue).not.toHaveBeenCalled();
      if (enrolled) { expect(h.sendTemplate).not.toHaveBeenCalled(); expect(res).toEqual({ sent: 0, skipped: 2, failed: 0 }); }
      else { expect(h.sendTemplate).toHaveBeenCalledTimes(2); expect(res.sent).toBe(2); }
    });

    it("inviteForDrive skips by row existence in every mode (the mock's enrolled lead = a live/canary row)", async () => {
      h.state.matches = twoMatches();
      const r = await inviteForDrive("d1", { dryRun: false, max: 10 });
      const select = h.sqls.find((s) => s.includes("FROM he_match m JOIN he_lead l"))!;
      expect(select).toContain("NOT EXISTS (SELECT 1 FROM qualified_followup qf");
      expect(select).toContain("qf.mode_at_enqueue IN ('live','canary')");
      expect(select).toContain("COLLATE utf8mb4_unicode_ci");
      const invited = h.sendInviteEmail.mock.calls.map((c) => c[0]);
      if (enrolled) { expect(invited).toEqual(["m2"]); expect(r.sent).toBe(1); }
      else { expect(invited).toEqual(["m1", "m2"]); expect(r.sent).toBe(2); }
    });
  });

  it("whatsappFollowUps SQL carries the row-based skip clause in every mode", async () => {
    setEnv(env);
    await runFollowUps({ dryRun: false });
    const q = h.sqls.find((s) => s.includes("JOIN he_message e ON e.lead_id = m.lead_id") && s.includes("he_walkin_invite:%"))!;
    expect(q).toContain("JOIN he_lead l ON l.id = m.lead_id");
    expect(q).toContain("NOT EXISTS (SELECT 1 FROM qualified_followup qf");
    expect(q).toContain("qf.mobile10 = l.mobile10 COLLATE utf8mb4_unicode_ci");
    expect(q).toContain("qf.requisition_id = m.requisition_id");
  });
});

describe("ownership lookup failure", () => {
  it("notifyQualifiedLead fails closed with a reason (any mode)", async () => {
    h.state.hasLiveThrows = true;
    const out = await notifyQualifiedLead("L1");
    expect(out.skipped).toEqual([{ channel: "all", reason: "Follow-up lookup failed; outreach held" }]);
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(h.emailSend).not.toHaveBeenCalled();
  });
  it("followupEnrolled rethrows a database error", async () => {
    h.state.enrollThrows = true;
    await expect(followupEnrolled("L1")).rejects.toThrow("db down");
  });
  it("followupEnrolled SQL is collation-safe, parameterised and counts open live / canary rows", async () => {
    await followupEnrolled("L1");
    const q = h.sqls.find((s) => s.includes("qualified_followup qf"))!;
    expect(q).toContain("qf.mode_at_enqueue IN ('live','canary')");
    expect(q).toContain("qf.stopped_reason IS NULL");
    expect(q).toContain("qf.meta_lead_id = r.id COLLATE utf8mb4_unicode_ci");
    expect(q).toContain("qf.mobile10 = RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10) COLLATE utf8mb4_unicode_ci");
    expect(q).not.toContain("L1");
  });
});

describe("STOP is honoured by notifyQualifiedLead in every mode and force does not override it", () => {
  it.each(MODES)("$name", async ({ env }) => {
    setEnv(env);
    h.state.optedOut = true;
    for (const force of [false, true]) {
      const out = await notifyQualifiedLead("L1", { force });
      expect(out.skipped).toEqual([{ channel: "all", reason: "Candidate opted out (STOP)" }]);
      expect(out.attempted).toEqual([]);
    }
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(h.emailSend).not.toHaveBeenCalled();
  });
  it.each(MODES)("$name: an opt-out lookup error fails CLOSED for outbound (nothing sent, held with a reason)", async ({ env }) => {
    setEnv(env);
    h.state.optedOutThrows = true;
    const out = await notifyQualifiedLead("L1");
    expect(out.skipped).toEqual([{ channel: "all", reason: "Opt-out lookup failed; outreach held" }]);
    expect(out.succeeded).toEqual([]);
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(h.emailSend).not.toHaveBeenCalled();
  });
});

describe("ingest enqueue ordering", () => {
  const order: string[] = [];
  const ingest = async () => metaCampaignService.ingestLead({ formId: "f1", leadgenId: "g1", prefetchedDetail: { id: "g1", field_data: [] } as never });
  beforeEach(async () => {
    vi.useRealTimers();
    order.length = 0;
    vi.spyOn(metaCampaignService, "createCandidateFromLead").mockResolvedValue(null);
    const outreach = await import("../../meta-campaign/lead-outreach.service.js");
    vi.mocked(outreach.notifyQualifiedLead).mockImplementation((async () => { order.push("notify"); return { leadId: "x", attempted: [], succeeded: [], skipped: [], failed: [] }; }) as never);
    h.enqueue.mockImplementation((() => new Promise((res) => setTimeout(() => { order.push("enqueue-resolved"); res({ status: "enqueued" }); }, 5))) as never);
  });

  it.each(["dry_run", "live"])("mode %s: the enqueue is awaited before notifyQualifiedLead", async (mode) => {
    setEnv({ QUAL_FOLLOWUP_MODE: mode });
    await ingest();
    expect(order).toEqual(["enqueue-resolved", "notify"]);
  });
  it.each([undefined, "off"])("mode %s: the enqueue stays fire-and-forget (order as today)", async (mode) => {
    setEnv(mode ? { QUAL_FOLLOWUP_MODE: mode } : {});
    await ingest();
    expect(order[0]).toBe("notify");
  });
  it("ingest passes skipOutreach to the enrolment (held_manual for backfills, D13)", async () => {
    setEnv({ QUAL_FOLLOWUP_MODE: "dry_run" });
    await ingest();
    expect(h.enqueue).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ skipOutreach: false })); // through the one arrival path, with its switches
    h.enqueue.mockClear();
    await metaCampaignService.ingestLead({ formId: "f1", leadgenId: "g2", prefetchedDetail: { id: "g2", field_data: [] } as never, skipOutreach: true });
    expect(h.enqueue).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ skipOutreach: true }));
  });
  it("a rejected enqueue never breaks ingest, and notifyQualifiedLead still runs", async () => {
    setEnv({ QUAL_FOLLOWUP_MODE: "dry_run" });
    h.enqueue.mockImplementation((() => Promise.reject(new Error("db down"))) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(ingest()).resolves.toBeTruthy();
    expect(order).toEqual(["notify"]);
    warn.mockRestore();
  });
});
