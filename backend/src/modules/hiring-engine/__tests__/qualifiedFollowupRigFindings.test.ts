import { beforeEach, describe, expect, it, vi } from "vitest";

/** Defects found on the rig (Task 9-12 journeys): pinned so they stay fixed. */
const h = vi.hoisted(() => ({ sqls: [] as Array<{ sql: string; p: unknown[] }>, notified: true, pinbot: vi.fn(), mail: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      if (q.includes("FROM he_lead l LEFT JOIN he_lead_insight")) return [[{ id: "L1", mobile10: "9876543210", full_name: "Asha Rao", status: "new", meta_lead_id: "ML1", language_pref: "en" }]];
      if (q.includes("FROM meta_lead_raw WHERE id = ? AND notification_sent_at IS NOT NULL")) return [h.notified ? [{ 1: 1 }] : []];
      if (q.includes("FROM he_match m LEFT JOIN he_drive d")) return [[{ id: "M1", requisition_id: "R1", slot_at: "2026-10-10 10:00:00", token: "t", state: "invited", drive_id: "D1", drive_date: "2026-10-10", drive_status: "active", reinvite: 0, designation_name: "CSE", branch_name: "NOIDA-2", bmi_assessment_url: null, approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 0, address: "Sector 62", latitude: null, longitude: null, hr_contact: null }]];
      if (q.includes("COUNT(*) AS today")) return [[{ today: 0, last_at: null }]];
      if (q.includes("MAX(created_at) AS last_at FROM he_message")) return [[{ last_at: null }]];
      if (q.includes("FROM he_template WHERE template_key IN")) return [[{ template_key: "he_walkin_invite:en", pinbot_name: "t1_he_walkin_invitation", language: "en", approval_state: "approved" }]];
      if (q.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id LEFT JOIN he_drive d")) return [[{ id: "M1", lead_id: "L1", requisition_id: "R1", slot_at: "2026-10-10 10:00:00", token: "t", drive_id: "D1", drive_date: "2026-10-10", drive_status: "active", full_name: "Asha", email: "a@x.in", lead_status: "invited", mobile10: "9876543210", designation_name: "CSE", branch_name: "NOIDA-2", approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 0, address: "x", latitude: null, longitude: null }]];
      if (q.includes("SELECT UUID() AS id")) return [[{ id: "uuid-1" }]];
      if (q.startsWith("SELECT")) return [[]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({ PinbotWhatsAppProvider: class { isConfigured() { return true; } async sendTemplate(...a: unknown[]) { h.pinbot(...a); return { success: true, message_id: "w1" }; } } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: async (...a: unknown[]) => { h.mail(...a); return { messageId: "e1" }; } } }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), hasConsent: vi.fn(async () => true), setLeadStatus: vi.fn() }));
vi.mock("../he-campaign-config.service.js", () => ({ channelAllowed: vi.fn(async () => true) }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false) }));

import { sendTemplateToLead } from "../he-send.service.js";
import { sendFollowUpEmail } from "../he-followup-email.service.js";

const NOON = new Date("2026-10-09T06:30:00Z");
beforeEach(() => { h.sqls = []; h.notified = true; h.pinbot.mockReset(); h.mail.mockReset(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOON); });

describe("rig findings", () => {
  it("the follow-up worker's own Notified mirror does not block its WhatsApp (3-day Meta-flow guard is for other senders)", async () => {
    expect((await sendTemplateToLead({ leadId: "L1", key: "he_walkin_invite", matchId: "M1", followupStep: true, sentBy: "followup" })).status).toBe("sent");
    expect(h.sqls.some((s) => s.sql.includes("notification_sent_at IS NOT NULL"))).toBe(false);
  });
  it("the engine (no sentBy) is still held off by a recent Meta-flow notification", async () => {
    expect(await sendTemplateToLead({ leadId: "L1", key: "he_walkin_invite", matchId: "M1" })).toEqual({ status: "blocked", reason: "meta_flow_already_notified" });
  });
  it("follow-up emails of the worker are tagged sent_by followup; the engine's are not", async () => {
    await sendFollowUpEmail("reminder_1d", "M1", { sentBy: "followup" });
    const ins = h.sqls.find((s) => s.sql.startsWith("INSERT INTO he_message"))!;
    expect(ins.sql).toContain(", sent_by)");
    expect(ins.p.at(-1)).toBe("followup");
    h.sqls = [];
    await sendFollowUpEmail("no_show", "M1");
    expect(h.sqls.find((s) => s.sql.startsWith("INSERT INTO he_message"))!.sql).not.toContain("sent_by");
  });
});
