import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pin of the legacy Meta outreach with every follow-up switch off (prod today), taken before its retirement (unified Task 14): the
 * provider calls of notifyQualifiedLead with Pinbot configured and not configured, and the SQL of the 30-minute sync.
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>, calls: [] as unknown[][], pinbotOn: true,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.includes("FROM meta_lead_raw ml")) {
        return [[{ id: "L1", parsed_name: "Asha Rao", parsed_phone: "9876543210", parsed_email: "a@x.in", screening_result: "qualified", notification_sent_at: null,
          requisition_id: "R1", campaign_id: "C1", designation_name: "CSE", branch_name: "NOIDA-2", requisition_code: "R1", bmi_assessment_url: "https://bmi.test/x", salary_min: null, salary_max: null,
          approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, parsed_location: "Noida",
          current_address: null, permanent_address: null, branch_state: "UP", branch_address: "Sector 62, Noida", branch_city: "Noida", branch_lat: null, branch_lng: null }]];
      }
      if (q.startsWith("SELECT id FROM meta_lead_raw") && q.includes("notification_sent_at IS NULL")) return [[{ id: "L1" }]];
      return [[]];
    }),
  },
}));
vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({
  PinbotWhatsAppProvider: class { isConfigured() { return h.pinbotOn; } async sendTemplate(...a: unknown[]) { h.calls.push(["pinbot", ...a]); return { success: true }; } },
}));
vi.mock("../../communication/providers/provider.factory.js", () => ({ providerFactory: { getProviderAsync: vi.fn(async () => ({ getName: () => "db-whatsapp", isConfigured: () => true, send: async (...a: unknown[]) => { h.calls.push(["db_provider", ...a]); return { success: true }; } })) } }));
vi.mock("../../communication/provider-config.service.js", () => ({ providerConfigService: { loadActiveConfig: vi.fn(async () => null) } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: async (m: { to: string; subject: string }) => { h.calls.push(["email", m.to, m.subject]); } } }));
vi.mock("../voicebot.provider.js", () => ({ triggerVoiceCall: vi.fn(), isVoicebotConfigured: () => false }));
vi.mock("../vapi-voicebot.provider.js", () => ({ triggerVapiCallWithInlineScript: vi.fn(), isVapiConfigured: () => false }));
vi.mock("../interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn(async () => ({ date: "2026-10-10", time: "11:00:00", dateLabel: "Sat 10 Oct", timeLabel: "11:00 AM" })) }));
vi.mock("../../hiring-engine/he-campaign-config.service.js", () => ({ metaOutreachBlockedByEngine: vi.fn(async () => null), heOwnsCampaign: vi.fn(async () => false) }));
vi.mock("../../hiring-engine/qualified-followup.service.js", async (orig) => ({ ...(await orig<typeof import("../../hiring-engine/qualified-followup.service.js")>()), personOptedOut: vi.fn(async () => false), enqueueMetaLeadFollowup: vi.fn(async () => ({ status: "skipped_off" })) }));

import { notifyQualifiedLead } from "../lead-outreach.service.js";
import { notifyNewQualifiedLeads } from "../../../cron/metaLeadSync.cron.js";

beforeEach(() => { h.sqls = []; h.calls = []; h.pinbotOn = true; for (const k of ["QUAL_FOLLOWUP_MODE", "QUAL_FOLLOWUP_TEST_MODE"]) delete process.env[k]; });

describe("legacy Meta outreach pin (switches off)", () => {
  it("notifyQualifiedLead, Pinbot configured: provider calls", async () => {
    const out = await notifyQualifiedLead("L1");
    expect({ out, calls: h.calls }).toMatchSnapshot();
  });
  it("notifyQualifiedLead, Pinbot not configured: provider calls", async () => {
    h.pinbotOn = false;
    const out = await notifyQualifiedLead("L1");
    expect({ out, calls: h.calls }).toMatchSnapshot();
  });
  it("notifyNewQualifiedLeads SQL", async () => {
    await notifyNewQualifiedLeads();
    expect(h.sqls.filter((s) => s.sql.includes("FROM meta_lead_raw") && s.sql.includes("notification_sent_at IS NULL")).map((s) => ({ sql: s.sql, p: s.p.map((x) => (x instanceof Date ? "<window start>" : x)) }))).toMatchSnapshot();
  });
});
