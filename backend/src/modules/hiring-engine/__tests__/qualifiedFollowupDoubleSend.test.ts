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
      if (sql.includes("SELECT id FROM meta_lead_raw") && sql.includes("notification_sent_at IS NULL")) return [[{ id: "L1" }, { id: "L2" }]];
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
vi.mock("../../meta-campaign/whatsapp-web.provider.js", () => ({ sendWhatsAppNotification: vi.fn(), isWhatsAppWebConfigured: () => false }));
vi.mock("../../meta-campaign/wassenger.provider.js", () => ({ sendShortlistMessage: vi.fn(), sendCustomMessage: vi.fn(), isWassengerConfigured: () => false }));
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

    it("notifyQualifiedLead", async () => {
      const out = await notifyQualifiedLead("L1");
      if (steps) {
        expect(out.skipped).toEqual([{ channel: "all", reason: "Handled by the follow-up pipeline" }]);
        expect(out.attempted).toEqual([]);
        expect(h.sendTemplate).not.toHaveBeenCalled();
        expect(h.emailSend).not.toHaveBeenCalled();
        const forced = await notifyQualifiedLead("L1", { force: true });
        expect(forced.succeeded).toContain("whatsapp");
        expect(h.sendTemplate).toHaveBeenCalledTimes(1);
        expect(h.emailSend).toHaveBeenCalledTimes(1);
      } else {
        expect(out.succeeded).toEqual(expect.arrayContaining(["whatsapp", "email"]));
        expect(h.sendTemplate).toHaveBeenCalledTimes(1);
        expect(h.emailSend).toHaveBeenCalledTimes(1);
        // The pipeline is only consulted when it owns the sends.
        if (!owns) expect(followupSql()).toHaveLength(0);
      }
    });

    it("notifyNewQualifiedLeads (sync)", async () => {
      const res = await notifyNewQualifiedLeads();
      if (owns) {
        expect(h.enqueue).toHaveBeenCalledTimes(2);
        expect(h.enqueue).toHaveBeenCalledWith("L1", "live");
        // enqueue says "enqueued": handed over, nothing messaged by the old flow
        expect(h.sendTemplate).not.toHaveBeenCalled();
        expect(res).toEqual({ sent: 0, skipped: 2, failed: 0 });
      } else {
        expect(h.enqueue).not.toHaveBeenCalled();
        expect(h.sendTemplate).toHaveBeenCalledTimes(2); // notifyQualifiedLead once per lead
        expect(res.sent).toBe(2);
        expect(followupSql()).toHaveLength(0);
      }
    });

    it("inviteForDrive", async () => {
      h.state.matches = twoMatches();
      const r = await inviteForDrive("d1", { dryRun: false, max: 10 });
      const select = h.sqls.find((s) => s.includes("FROM he_match m JOIN he_lead l"))!;
      if (owns) {
        expect(select).toContain("NOT EXISTS (SELECT 1 FROM qualified_followup qf");
        expect(select).toContain("COLLATE utf8mb4_unicode_ci");
      } else {
        expect(select).not.toContain("qualified_followup");
      }
      const invited = h.sendInviteEmail.mock.calls.map((c) => c[0]);
      if (steps) { expect(invited).toEqual(["m2"]); expect(r.sent).toBe(1); }
      else { expect(invited).toEqual(["m1", "m2"]); expect(r.sent).toBe(2); }
    });
  });

  it("whatsappFollowUps SQL carries the skip clause only when the pipeline owns sends", async () => {
    setEnv(env);
    await runFollowUps({ dryRun: false });
    const q = h.sqls.find((s) => s.includes("JOIN he_message e ON e.lead_id = m.lead_id") && s.includes("he_walkin_invite:%"))!;
    if (owns) {
      expect(q).toContain("JOIN he_lead l ON l.id = m.lead_id");
      expect(q).toContain("NOT EXISTS (SELECT 1 FROM qualified_followup qf");
      expect(q).toContain("qf.mobile10 = l.mobile10 COLLATE utf8mb4_unicode_ci");
      expect(q).toContain("qf.requisition_id = m.requisition_id");
    } else {
      expect(q).not.toContain("qualified_followup");
      expect(q).not.toContain("JOIN he_lead l ON"); // original SQL, no extra join
      expect(q).toContain("FROM he_match m\n       JOIN he_message e ON");
    }
  });
});

describe("live mode: sync falls back to the old flow only when the enqueue is not a handover", () => {
  beforeEach(() => setEnv({ QUAL_FOLLOWUP_MODE: "live" }));
  it.each(["invalid", "not_qualified"])("enqueue %s then notifyQualifiedLead runs (not enrolled -> sends)", async (status) => {
    h.enqueue.mockResolvedValue({ status });
    const res = await notifyNewQualifiedLeads();
    expect(h.sendTemplate).toHaveBeenCalledTimes(2);
    expect(res.sent).toBe(2);
  });
  it("enqueue exists + a live row (open or stopped) counts as handed over", async () => {
    h.enqueue.mockResolvedValue({ status: "exists" });
    h.state.liveRow = "live";
    const res = await notifyNewQualifiedLeads();
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, skipped: 2, failed: 0 });
  });
  it.each(["dry_run", "test"])("enqueue exists but the row is tagged %s: the old flow still messages the lead", async (tag) => {
    h.enqueue.mockResolvedValue({ status: "exists" });
    h.state.liveRow = tag;
    const res = await notifyNewQualifiedLeads();
    expect(h.sendTemplate).toHaveBeenCalledTimes(2);
    expect(res.sent).toBe(2);
  });
  it("enqueue exists and the live-row lookup errors: falls to the old flow, never silenced", async () => {
    h.enqueue.mockResolvedValue({ status: "exists" });
    h.state.hasLiveThrows = true;
    await notifyNewQualifiedLeads();
    expect(h.sendTemplate).toHaveBeenCalledTimes(2);
  });
  it("the live sync SELECT skips leads with an open live row; non-live SELECT text is unchanged", async () => {
    await notifyNewQualifiedLeads();
    const live = h.sqls.find((x) => x.includes("SELECT id FROM meta_lead_raw"))!;
    expect(live).toContain("NOT EXISTS (SELECT 1 FROM qualified_followup qf");
    expect(live).not.toContain("stopped_reason");
    expect(live).toContain("COLLATE utf8mb4_unicode_ci");
    setEnv({ QUAL_FOLLOWUP_MODE: "dry_run" });
    h.sqls.length = 0;
    await notifyNewQualifiedLeads();
    const off = h.sqls.find((x) => x.includes("SELECT id FROM meta_lead_raw"))!;
    expect(off).toBe(`SELECT id FROM meta_lead_raw
      WHERE screening_result = 'qualified'
        AND notification_sent_at IS NULL
        AND created_at >= ?
      ORDER BY created_at ASC
      LIMIT 100`);
  });
  it("enqueue invalid and the lookup then finds an enrolled row: skipped, notification_sent_at stays untouched", async () => {
    h.enqueue.mockResolvedValue({ status: "invalid" });
    h.state.enrolled = true;
    const res = await notifyNewQualifiedLeads();
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(h.sqls.some((s) => s.includes("UPDATE meta_lead_raw SET notification_sent_at"))).toBe(false);
  });
  it("an enqueue that throws falls through to the old flow", async () => {
    h.enqueue.mockRejectedValue(new Error("boom"));
    await notifyNewQualifiedLeads();
    expect(h.sendTemplate).toHaveBeenCalledTimes(2);
  });
});

describe("enrolment lookup failure", () => {
  it("live: notifyQualifiedLead fails closed with a reason", async () => {
    setEnv({ QUAL_FOLLOWUP_MODE: "live" });
    h.state.enrollThrows = true;
    const out = await notifyQualifiedLead("L1");
    expect(out.skipped).toEqual([{ channel: "all", reason: "Follow-up lookup failed; pipeline owns sends" }]);
    expect(h.sendTemplate).not.toHaveBeenCalled();
    expect(h.emailSend).not.toHaveBeenCalled();
  });
  it.each(MODES.filter((m) => !m.owns))("$name: a failing lookup is never consulted, so outreach is not silenced", async ({ env }) => {
    setEnv(env);
    h.state.enrollThrows = true;
    const out = await notifyQualifiedLead("L1");
    expect(out.succeeded).toContain("whatsapp");
  });
  it("followupEnrolled rethrows a database error", async () => {
    h.state.enrollThrows = true;
    await expect(followupEnrolled("L1")).rejects.toThrow("db down");
  });
  it("followupEnrolled SQL is collation-safe, parameterised and only counts open live rows", async () => {
    await followupEnrolled("L1");
    const q = h.sqls.find((s) => s.includes("qualified_followup qf"))!;
    expect(q).toContain("qf.mode_at_enqueue = 'live'");
    expect(q).toContain("qf.stopped_reason IS NULL");
    expect(q).toContain("qf.meta_lead_id = r.id COLLATE utf8mb4_unicode_ci");
    expect(q).toContain("qf.mobile10 = RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10) COLLATE utf8mb4_unicode_ci");
    expect(q).toContain("qf.requisition_id = COALESCE(r.requisition_id, c.requisition_id) COLLATE utf8mb4_unicode_ci");
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
  it.each(MODES.filter((m) => !m.owns))("$name: an opt-out lookup error fails open (outreach as before)", async ({ env }) => {
    setEnv(env);
    h.state.optedOutThrows = true;
    const out = await notifyQualifiedLead("L1");
    expect(out.succeeded).toContain("whatsapp");
  });
  it("live: an opt-out lookup error fails closed", async () => {
    setEnv({ QUAL_FOLLOWUP_MODE: "live" });
    h.state.optedOutThrows = true;
    const out = await notifyQualifiedLead("L1");
    expect(out.skipped[0]?.reason).toBe("Opt-out lookup failed; pipeline owns sends");
    expect(h.sendTemplate).not.toHaveBeenCalled();
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
  it("a rejected enqueue never breaks ingest, and notifyQualifiedLead still runs", async () => {
    setEnv({ QUAL_FOLLOWUP_MODE: "dry_run" });
    h.enqueue.mockImplementation((() => Promise.reject(new Error("db down"))) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(ingest()).resolves.toBeTruthy();
    expect(order).toEqual(["notify"]);
    warn.mockRestore();
  });
});
