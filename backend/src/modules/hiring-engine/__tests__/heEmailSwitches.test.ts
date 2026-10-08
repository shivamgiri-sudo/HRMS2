import { beforeEach, describe, expect, it, vi } from "vitest";

/** Hiring Engine emails: stop link behind policy.email_buttons.stop_link (default off), Reply-To only when the inbound mailbox is set. */
const h = vi.hoisted(() => ({ send: vi.fn(async (..._a: unknown[]) => ({ messageId: "smtp-1" })), params: [] as Array<{ param_key: string; value: number }> }));
const ROW = {
  id: "11111111-2222-3333-4444-555555555555", lead_id: "L1", requisition_id: "R1", slot_at: "2026-10-09 11:00:00", token: "a".repeat(32), drive_id: "D1", drive_date: "2026-10-09", drive_status: "active",
  full_name: "Asha Rao", email: "asha@x.in", lead_status: "contacted", mobile10: "9876543210", meta_lead_id: null, designation_name: "CSE", branch_name: "NOIDA-2",
  approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 0, address: "C-27 Sector 62", latitude: 28.6, longitude: 77.3,
};
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      if (sql.includes("FROM he_match m JOIN he_lead l")) return [[ROW]];
      if (sql.includes("FROM he_model_param")) return [h.params];
      return [[]];
    }),
  },
}));
vi.mock("../../communication/email.service.js", () => ({ emailService: { isConfigured: () => true, send: h.send } }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn() }));
vi.mock("../he-guardrails.js", () => ({ istHour: () => 11 }));
vi.mock("../he-send.service.js", () => ({ dateLabel: (d: string) => `D:${d}`, timeLabel: (t: string) => `T:${t}`, sendsPaused: () => false, metaFlowNotifiedRecently: async () => false }));
vi.mock("../he-campaign-config.service.js", () => ({ channelAllowed: async () => true }));

import { sendInviteEmail } from "../he-email.service.js";
import { sendFollowUpEmail } from "../he-followup-email.service.js";

beforeEach(() => { h.send.mockClear(); h.params = []; delete process.env.INBOUND_EMAIL_REPLY_TO; process.env.HE_PUBLIC_BASE_URL = "https://x"; });

const arg = () => h.send.mock.calls[0][0] as unknown as { html: string; text: string; replyTo?: string };

describe("Hiring Engine email switches", () => {
  it("stop_link on: the invite email gets the Stop messages link to the same page", async () => {
    h.params = [{ param_key: "policy.email_buttons.stop_link", value: 1 }];
    await sendInviteEmail("M1");
    expect(arg().html).toContain(`href="https://x/w/${"a".repeat(32)}?a=stop"`);
    expect(arg().text).toContain(`Stop messages: https://x/w/${"a".repeat(32)}?a=stop`);
  });
  it("stop_link off: no stop link", async () => {
    await sendInviteEmail("M1");
    expect(arg().html).not.toContain("?a=stop");
  });
  it("Reply-To carries the match token when INBOUND_EMAIL_REPLY_TO has {token}", async () => {
    process.env.INBOUND_EMAIL_REPLY_TO = "replies+{token}@x.in";
    await sendInviteEmail("M1");
    expect(arg().replyTo).toBe(`replies+${"a".repeat(32)}@x.in`);
    h.send.mockClear();
    await sendFollowUpEmail("reminder_1d", "M1");
    expect(arg().replyTo).toBe(`replies+${"a".repeat(32)}@x.in`);
  });
});
