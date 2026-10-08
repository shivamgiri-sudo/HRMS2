import { describe, expect, it, vi } from "vitest";

vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({ PinbotWhatsAppProvider: class { isConfigured() { return false; } } }));

import { anyReplyProviderConfigured, sendLeadReply } from "../lead-reply.js";

const deps = (p: { conf: boolean; ok?: boolean; err?: string }) => ({
  pinbot: { isConfigured: () => p.conf, send: vi.fn(async () => (p.ok ? { success: true, message_id: "pb-1" } : { success: false, error: p.err })) },
});

describe("sendLeadReply (HR inbox reply, Pinbot only)", () => {
  it("sends through Pinbot", async () => {
    expect(await sendLeadReply("9876543210", "hi", deps({ conf: true, ok: true }))).toEqual({ success: true, provider: "pinbot", messageId: "pb-1" });
  });
  it("explains the closed 24-hour window instead of Meta's raw code", async () => {
    const r = await sendLeadReply("9876543210", "hi", deps({ conf: true, ok: false, err: "(#131047) Re-engagement message" }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/last 24 hours/);
  });
  it("a Pinbot failure is reported as such; no other gateway is tried", async () => {
    expect((await sendLeadReply("1", "hi", deps({ conf: true, ok: false, err: "a" }))).error).toBe("Pinbot: a");
  });
  it("Pinbot not configured: no provider", async () => {
    const none = deps({ conf: false });
    expect(anyReplyProviderConfigured(none)).toBe(false);
    expect((await sendLeadReply("1", "hi", none)).error).toMatch(/Pinbot \(WhatsApp\) is not configured/);
  });
});
