import { beforeEach, describe, expect, it, vi } from "vitest";

/** Legacy Meta Notify email answer buttons: per-path switch (default off), campaign and test-lead lists, invite written after a good send. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  emailSend: vi.fn(async (..._a: unknown[]) => ({ messageId: "smtp-1" })),
  pinbotSend: vi.fn(async (..._a: unknown[]) => ({ success: true })),
  vapi: vi.fn(async (..._a: unknown[]) => ({ status: "triggered" })),
  params: [] as Array<{ param_key: string; value: number }>,
  settings: {} as Record<string, string>,
  campaign: "C1",
  slot: true,
  linkCalls: [] as Array<{ input: Record<string, unknown>; o: Record<string, unknown> }>,
  matchToken: null as string | null,
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
          requisition_id: "11111111-1111-1111-1111-111111111111", campaign_id: h.campaign, created_at: "2026-10-08 09:00:00" }]];
      }
      if (sql.includes("FROM he_model_param")) return [h.params];
      if (sql.includes("FROM org_settings")) return [Object.entries(h.settings).filter(([k]) => (p as string[]).includes(k)).map(([setting_key, setting_value]) => ({ setting_key, setting_value }))];
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
vi.mock("../interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn(async () => (h.slot ? { date: "2026-10-09", time: "11:00:00", dateLabel: "Fri, 9 Oct 2026", timeLabel: "11:00 AM" } : undefined)) }));
vi.mock("../../hiring-engine/walkin-invite.service.js", async () => {
  const actual = await vi.importActual<typeof import("../../hiring-engine/walkin-invite.service.js")>("../../hiring-engine/walkin-invite.service.js");
  return {
    ...actual,
    inviteLinkFor: vi.fn(async (input: Record<string, unknown>, o: Record<string, unknown> = {}) => {
      h.linkCalls.push({ input, o });
      const token = h.matchToken ?? String(o.token ?? "0".repeat(32));
      return { kind: h.matchToken ? "match" : "invite", token, answerUrl: `https://x/w/${token}`, matchId: h.matchToken ? "M1" : null, inviteId: o.simulate || h.matchToken ? null : "I1" };
    }),
  };
});
vi.mock("../../hiring-engine/he-campaign-config.service.js", () => ({ metaOutreachBlockedByEngine: vi.fn(async () => null) }));
vi.mock("../../hiring-engine/qualified-followup.service.js", () => ({ followupEnrolled: vi.fn(async () => false), personOptedOut: vi.fn(async () => false) }));
vi.mock("../../hiring-engine/qualified-followup.policy.js", () => ({ pipelineOwnsSends: () => false }));

import { notifyQualifiedLead } from "../lead-outreach.service.js";

const on = (k: string) => h.params.push({ param_key: `policy.email_buttons.${k}`, value: 1 });
const html = () => String((h.emailSend.mock.calls[0]?.[0] as { html: string }).html);
const sent = () => h.emailSend.mock.calls[0]?.[0] as Record<string, unknown>;
beforeEach(() => {
  h.sqls = []; h.emailSend.mockReset().mockResolvedValue({ messageId: "smtp-1" }); h.pinbotSend.mockClear(); h.vapi.mockClear();
  h.params = []; h.settings = {}; h.campaign = "C1"; h.slot = true; h.linkCalls = []; h.matchToken = null;
  delete process.env.INBOUND_EMAIL_REPLY_TO;
});

describe("legacy Meta email buttons", () => {
  it("switch off: no link is built and the email has no answer page link", async () => {
    await notifyQualifiedLead("L1");
    expect(h.linkCalls).toHaveLength(0);
    expect(html()).not.toContain("/w/");
    expect(sent()).not.toHaveProperty("text");
    expect(sent()).not.toHaveProperty("replyTo");
  });

  it("switch on: the three answers and the stop link to /w/<token>", async () => {
    on("legacy_meta");
    await notifyQualifiedLead("L1");
    for (const a of ["yes", "later", "no", "stop"]) expect(html()).toMatch(new RegExp(`href="https://x/w/[a-f0-9]{32}\\?a=${a}"`));
    expect(html().indexOf("?a=yes")).toBeLessThan(html().indexOf("Complete Assessment"));
    expect(String(sent().text)).toMatch(/Yes: https:\/\/x\/w\/[a-f0-9]{32}\?a=yes/);
    expect(h.linkCalls[0].input).toMatchObject({ mobile10: "9876543210", requisitionId: "11111111-1111-1111-1111-111111111111", metaLeadId: "L1", campaignId: "C1", branchName: "NOIDA-2", slotAt: "2026-10-09 11:00:00", sourcePath: "legacy_meta" });
  });

  it("campaign list: only that campaign's leads get buttons", async () => {
    h.settings.he_email_buttons_campaigns = JSON.stringify(["C1"]);
    await notifyQualifiedLead("L1");
    expect(html()).toContain("?a=yes");
    h.emailSend.mockClear(); h.campaign = "C2";
    await notifyQualifiedLead("L1");
    expect(html()).not.toContain("?a=yes");
  });

  it("test-lead list: only that lead", async () => {
    h.settings.he_email_buttons_test_leads = JSON.stringify(["L9"]);
    await notifyQualifiedLead("L1");
    expect(html()).not.toContain("?a=yes");
    h.emailSend.mockClear(); h.settings.he_email_buttons_test_leads = JSON.stringify(["L1"]);
    await notifyQualifiedLead("L1");
    expect(html()).toContain("?a=yes");
  });

  it("the invite row is written only after a successful send, with the token the email carried", async () => {
    on("legacy_meta");
    await notifyQualifiedLead("L1");
    expect(h.linkCalls.map((c) => !!c.o.simulate)).toEqual([true, false]);
    expect(h.linkCalls[1].o.token).toBe(h.linkCalls[0].o.token);
    expect(html()).toContain(`/w/${String(h.linkCalls[0].o.token)}?a=yes`);
  });

  it("a failed send writes no invite", async () => {
    on("legacy_meta");
    h.emailSend.mockRejectedValueOnce(new Error("smtp down"));
    await notifyQualifiedLead("L1");
    expect(h.linkCalls.map((c) => !!c.o.simulate)).toEqual([true]);
  });

  it("no slot: no buttons even when on", async () => {
    on("legacy_meta"); h.slot = false;
    await notifyQualifiedLead("L1");
    expect(h.linkCalls).toHaveLength(0);
    expect(html()).not.toContain("/w/");
  });

  it("an existing he_match: the link uses the match token and no invite row is written", async () => {
    on("legacy_meta"); h.matchToken = "a".repeat(32);
    await notifyQualifiedLead("L1");
    expect(html()).toContain(`/w/${"a".repeat(32)}?a=yes`);
    expect(h.linkCalls).toHaveLength(1);
  });

  it("Reply-To from INBOUND_EMAIL_REPLY_TO, with the token when it has {token}", async () => {
    process.env.INBOUND_EMAIL_REPLY_TO = "replies+{token}@x.in";
    on("legacy_meta");
    await notifyQualifiedLead("L1");
    expect(sent().replyTo).toBe(`replies+${String(h.linkCalls[0].o.token)}@x.in`);
    h.emailSend.mockClear(); h.params = [];
    await notifyQualifiedLead("L1");
    expect(sent().replyTo).toBe("replies@x.in");
  });

  it("the caller's source path is stamped on the invite (bulk / sync)", async () => {
    on("legacy_meta");
    await notifyQualifiedLead("L1", { sourcePath: "legacy_meta_bulk" });
    expect(h.linkCalls[0].input.sourcePath).toBe("legacy_meta_bulk");
  });

  it("a switch read error leaves the email unchanged", async () => {
    const { db } = await import("../../../db/mysql.js");
    const impl = vi.mocked(db.execute).getMockImplementation()!;
    vi.mocked(db.execute).mockImplementation(async (sql: string, p?: unknown[]) => { if (String(sql).includes("he_model_param")) throw new Error("down"); return impl(sql, p as unknown[]); });
    on("legacy_meta");
    await notifyQualifiedLead("L1");
    vi.mocked(db.execute).mockImplementation(impl);
    expect(html()).not.toContain("/w/");
  });
});
