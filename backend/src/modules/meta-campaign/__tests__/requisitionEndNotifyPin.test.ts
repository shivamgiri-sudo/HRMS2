import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pin (WS3 E1, snapshot-first) of every statement the legacy Meta Notify issues for a qualified lead on an open requisition, taken
 * before the requisition end date could refuse first contacts. With the end-date switch off the statements must stay the same.
 */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  emailSend: vi.fn(async (..._a: unknown[]) => ({ messageId: "smtp-1" })),
  pinbotSend: vi.fn(async (..._a: unknown[]) => ({ success: true })),
  vapi: vi.fn(async (..._a: unknown[]) => ({ status: "triggered" })),
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
vi.mock("../whatsapp-web.provider.js", () => ({ sendWhatsAppNotification: vi.fn(), isWhatsAppWebConfigured: () => false }));
vi.mock("../wassenger.provider.js", () => ({ sendShortlistMessage: vi.fn(), sendCustomMessage: vi.fn(), isWassengerConfigured: () => false }));
vi.mock("../meta-messages.service.js", () => ({ saveMessage: vi.fn() }));
vi.mock("../interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn(async () => ({ date: "2026-10-09", time: "11:00:00", dateLabel: "Fri, 9 Oct 2026", timeLabel: "11:00 AM" })) }));
vi.mock("../../hiring-engine/he-campaign-config.service.js", () => ({ metaOutreachBlockedByEngine: vi.fn(async () => null) }));
vi.mock("../../hiring-engine/qualified-followup.service.js", () => ({ followupEnrolled: vi.fn(async () => false), personOptedOut: vi.fn(async () => false) }));
vi.mock("../../hiring-engine/qualified-followup.policy.js", () => ({ pipelineOwnsSends: () => false }));

import { notifyQualifiedLead } from "../lead-outreach.service.js";

beforeEach(() => { h.sqls = []; h.emailSend.mockClear(); h.pinbotSend.mockClear(); h.vapi.mockClear(); delete process.env.INBOUND_EMAIL_REPLY_TO; delete process.env.REQ_END_DATE_ENFORCEMENT; });

describe("legacy Notify statements pin (end-date switch off)", () => {
  it("every statement, in order", async () => {
    const outcome = await notifyQualifiedLead("L1");
    expect({ outcome, statements: h.sqls.map((s) => s.sql) }).toMatchSnapshot();
  });
  it("force does not change the statements before the send", async () => {
    await notifyQualifiedLead("L1", { force: true });
    expect(h.sqls.map((s) => s.sql)).toMatchSnapshot();
  });
});
