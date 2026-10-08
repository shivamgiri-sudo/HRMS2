import { beforeEach, describe, expect, it, vi } from "vitest";

/** WS3 E1: an enforced, passed requisition end date refuses the legacy Notify (force does not override); otherwise it sends as before. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  emailSend: vi.fn(async (..._a: unknown[]) => ({ messageId: "smtp-1" })),
  pinbotSend: vi.fn(async (..._a: unknown[]) => ({ success: true })),
  vapi: vi.fn(async (..._a: unknown[]) => ({ status: "triggered" })),
  validity: "2026-10-01" as string | null,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p });
      if (sql.includes("FROM meta_lead_raw ml")) {
        return [[{ id: "L1", parsed_name: "Asha Rao", parsed_phone: "9876543210", parsed_email: "asha@x.in", screening_result: "qualified", notification_sent_at: null,
          designation_name: "CSE", branch_name: "NOIDA-2", requisition_code: "R-1", bmi_assessment_url: "https://bmi.test/x", salary_min: 15000, salary_max: 18000,
          approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, parsed_location: "Noida",
          current_address: null, permanent_address: null, branch_state: "UP", branch_address: "C-27, Sector 62, Noida", branch_city: "Noida", branch_lat: 28.6, branch_lng: 77.3,
          requisition_id: "11111111-1111-1111-1111-111111111111", campaign_id: "C1", created_at: "2026-10-08 09:00:00" }]];
      }
      if (sql.includes("SELECT value FROM he_model_param")) return [[{ value: 1 }]];
      if (sql.includes("SELECT requisition_validity FROM job_requisition")) return [[{ requisition_validity: h.validity }]];
      return [[]];
    }),
  },
}));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: h.emailSend } }));
vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({
  PinbotWhatsAppProvider: class { isConfigured() { return true; } sendTemplate(...a: unknown[]) { return h.pinbotSend(...a); } },
}));
vi.mock("../../communication/providers/provider.factory.js", () => ({ providerFactory: { getProviderAsync: vi.fn() } }));
vi.mock("../../communication/provider-config.service.js", () => ({ providerConfigService: { loadActiveConfig: vi.fn() } }));
vi.mock("../voicebot.provider.js", () => ({ triggerVoiceCall: vi.fn(), isVoicebotConfigured: () => false }));
vi.mock("../vapi-voicebot.provider.js", () => ({ triggerVapiCallWithInlineScript: h.vapi, isVapiConfigured: () => true }));
vi.mock("../meta-messages.service.js", () => ({ saveMessage: vi.fn() }));
vi.mock("../interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn(async () => ({ date: "2026-10-09", time: "11:00:00", dateLabel: "Fri, 9 Oct 2026", timeLabel: "11:00 AM" })) }));
vi.mock("../../hiring-engine/he-campaign-config.service.js", () => ({ metaOutreachBlockedByEngine: vi.fn(async () => null) }));
vi.mock("../../hiring-engine/qualified-followup.service.js", () => ({ followupEnrolled: vi.fn(async () => false), followupHasLiveRow: vi.fn(async () => false), personOptedOut: vi.fn(async () => false), enqueueMetaLeadFollowup: vi.fn(async () => ({ status: "skipped_off" })) }));
// follow-up switches: the real policy (env off -> every source off, no query)

import { notifyQualifiedLead } from "../lead-outreach.service.js";

beforeEach(() => { h.sqls = []; h.emailSend.mockClear(); h.pinbotSend.mockClear(); h.vapi.mockClear(); h.validity = "2026-10-01"; process.env.REQ_END_DATE_ENFORCEMENT = "policy"; });

describe("Notify and the requisition end date", () => {
  it("refused with the reason, and force does not override; nothing sent, nothing written", async () => {
    for (const force of [false, true]) {
      h.sqls = [];
      const out = await notifyQualifiedLead("L1", { force });
      expect(out.skipped).toEqual([{ channel: "all", reason: "Outreach refused: requisition end date passed (2026-10-01)" }]);
      expect(h.emailSend).not.toHaveBeenCalled();
      expect(h.sqls.filter((s) => /^(INSERT|UPDATE)/.test(s.sql))).toEqual([]);
    }
  });
  it("an end date in the future sends as before", async () => {
    h.validity = "2099-12-31";
    const out = await notifyQualifiedLead("L1");
    expect(out.succeeded.length).toBeGreaterThan(0);
  });
});
