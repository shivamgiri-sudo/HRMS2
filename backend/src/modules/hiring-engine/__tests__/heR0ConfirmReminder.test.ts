import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R0: why T2 (he_walkin_confirmed) and the D-1 reminder never went out on prod. The confirm path runs through the REAL
 * sendTemplateToLead; only the db, Pinbot and the email sender are mocked. Pins first, then the fix tests.
 */
const h = vi.hoisted(() => ({
  sqls: [] as string[],
  pinbot: [] as unknown[],
  emails: [] as unknown[],
  events: [] as unknown[],
  hrContact: "hr.noida@teammas.in" as string | null,
  uuid: 0,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, _p: unknown[] = []) => {
      h.sqls.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("SELECT UUID() AS id")) return [[{ id: `uuid-${++h.uuid}` }]];
      if (sql.includes("FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ?")) return [[{ id: "M1", lead_id: "L1", requisition_id: "R1", drive_id: "D1", mobile10: "9876543210", status: "invited", meta_lead_id: null }]];
      if (sql.includes("FROM he_lead l LEFT JOIN he_lead_insight")) return [[{ id: "L1", mobile10: "9876543210", full_name: "Asha Rao", status: "invited", meta_lead_id: null, language_pref: null }]];
      if (sql.includes("FROM he_match m LEFT JOIN he_drive d")) {
        return [[{ id: "11111111-2222-3333-4444-555555555555", requisition_id: "R1", slot_at: "2026-10-09 14:00:00", token: "tok", state: "confirmed", drive_id: "D1", drive_date: "2026-10-09", drive_status: "active", reinvite: 0,
          designation_name: "CSE", branch_name: "NOIDA", bmi_assessment_url: null, approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 0,
          address: "Sector 62, Noida", latitude: null, longitude: null, hr_contact: h.hrContact }]];
      }
      if (sql.includes("COUNT(*) AS today")) return [[{ today: 0, last_at: null }]];
      if (sql.includes("MAX(created_at) AS last_at FROM he_message")) return [[{ last_at: null }]];
      if (sql.includes("FROM he_template WHERE template_key IN")) return [[{ template_key: "he_walkin_confirmed:en", pinbot_name: "t2_he_appointment_confirmed", language: "en", approval_state: "approved" }]];
      if (sql.includes("COUNT(*) AS n FROM he_lead_event")) return [[{ n: 0 }]];
      return [[]];
    }),
  },
}));
vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({
  PinbotWhatsAppProvider: class {
    isConfigured() { return true; }
    async sendTemplate(...a: unknown[]) { h.pinbot.push(a); return { success: true, message_id: "wamid.T2" }; }
  },
}));
vi.mock("../he-lead.service.js", () => ({
  addEvent: vi.fn(async (...a: unknown[]) => { h.events.push(a); }),
  hasConsent: vi.fn(async () => false), setLeadStatus: vi.fn(), revokeConsent: vi.fn(), persistSignals: vi.fn(),
  findLeadByMobile: vi.fn(), upsertLead: vi.fn(),
}));
vi.mock("../he-campaign-config.service.js", () => ({ channelAllowed: vi.fn(async () => true) }));
vi.mock("../he-policy.service.js", () => ({ whatsappRequiresOptIn: vi.fn(async () => false) }));
vi.mock("../he-followup-email.service.js", () => ({ sendFollowUpEmail: vi.fn(async (...a: unknown[]) => { h.emails.push(a); return { status: "sent" }; }) }));
vi.mock("../he-superbot.service.js", () => ({ dequeueSuperbotForMatch: vi.fn() }));
vi.mock("../he-master.service.js", () => ({ refreshLeadHistoryById: vi.fn() }));
vi.mock("../he-bot.service.js", () => ({ answerCandidateQuestion: vi.fn(), isLocationTap: vi.fn(() => false), sendLocationLink: vi.fn() }));
vi.mock("../he-insight.service.js", () => ({ recomputeInsight: vi.fn() }));
vi.mock("../qualified-followup.attention.js", () => ({ markFollowupCalled: vi.fn() }));
vi.mock("../candidate-response.service.js", () => ({ recordResponseSafe: vi.fn(async () => ({ id: 1, created: true, dedupeOf: null, conflict: false })) }));

import { recordInviteAnswer } from "../he-ingest.service.js";
import { sendTemplateToLead } from "../he-send.service.js";

const ENV_KEYS = ["HE_HR_CONTACT_NAME", "HE_HR_CONTACT_PHONE", "HE_SENDS_PAUSED"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  h.sqls = []; h.pinbot = []; h.emails = []; h.events = []; h.uuid = 0; h.hrContact = "hr.noida@teammas.in";
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("R0 pin: email-tap confirm with the HR contact configured", () => {
  it("pins the T2 + confirmation email calls on an email-tap confirm", async () => {
    process.env.HE_HR_CONTACT_NAME = "Priya Singh";
    process.env.HE_HR_CONTACT_PHONE = "98765 43210";
    await recordInviteAnswer("M1", "yes");
    expect(h.pinbot).toMatchSnapshot();
    expect(h.emails).toMatchSnapshot();
    expect(h.sqls.filter((s) => s.includes("he_match m LEFT JOIN he_drive d") || s.includes("he_template") || s.includes("INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key"))).toMatchSnapshot();
  });
});

describe("R0 pin: reminders select confirmed matches only", () => {
  it("pins the reminder SQL of a dry-run follow-up pass", async () => {
    const { runFollowUps } = await import("../he-engine.service.js");
    await runFollowUps({ dryRun: true });
    expect(h.sqls.filter((s) => s.includes("he_reminder") || s.includes("m.state = 'confirmed'"))).toMatchSnapshot();
  });
});

describe("R0 fix: T2 needs no HR contact env; a blocked follow-up template is visible", () => {
  it("sends T2 with the approved Pinbot name and en language when the HR contact env is unset (branch HR contact)", async () => {
    await recordInviteAnswer("M1", "yes");
    expect(h.pinbot).toHaveLength(1);
    const [to, name, params, lang] = h.pinbot[0] as [string, string, string[], string];
    expect(to).toBe("9876543210");
    expect(name).toBe("t2_he_appointment_confirmed");
    expect(lang).toBe("en");
    expect(params.slice(5)).toEqual(["our HR team", "hr.noida@teammas.in"]);
  });

  it("falls back to the branch reception when the branch has no HR contact either", async () => {
    h.hrContact = null;
    const r = await sendTemplateToLead({ leadId: "L1", key: "he_walkin_confirmed", matchId: "M1", transactional: true });
    expect(r.status).toBe("sent");
    expect((h.pinbot[0] as [string, string, string[]])[2].slice(5)).toEqual(["our HR team", "the branch reception"]);
  });

  it("logs a blocked T2 at warn and records followup_template_blocked", async () => {
    const { channelAllowed } = await import("../he-campaign-config.service.js");
    vi.mocked(channelAllowed).mockResolvedValueOnce(false);
    const { logger } = await import("../../../logger.js");
    const warn = vi.spyOn(logger, "warn");
    await recordInviteAnswer("M1", "yes");
    expect(h.pinbot).toHaveLength(0);
    expect(h.events).toContainEqual(["L1", "followup_template_blocked", expect.objectContaining({ channel: "whatsapp", detail: "he_walkin_confirmed: whatsapp_off_for_campaign" })]);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ key: "he_walkin_confirmed", status: "blocked", reason: "whatsapp_off_for_campaign" }), "[he-ingest] follow-up template not sent");
    warn.mockRestore();
  });
});
