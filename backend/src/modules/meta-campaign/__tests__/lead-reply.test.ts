import { describe, expect, it, vi } from "vitest";

vi.mock("../../communication/providers/whatsapp/pinbot.provider.js", () => ({ PinbotWhatsAppProvider: class { isConfigured() { return false; } } }));
vi.mock("../wassenger.provider.js", () => ({ isWassengerConfigured: () => false, sendCustomMessage: vi.fn() }));

import { anyReplyProviderConfigured, sendLeadReply } from "../lead-reply.js";

const deps = (p: { conf: boolean; ok?: boolean; err?: string }, w: { conf: boolean; ok?: boolean; err?: string }) => ({
  pinbot: { isConfigured: () => p.conf, send: vi.fn(async () => (p.ok ? { success: true, message_id: "pb-1" } : { success: false, error: p.err })) },
  wassenger: { isConfigured: () => w.conf, send: vi.fn(async () => (w.ok ? { success: true, messageId: "ws-1" } : { success: false, error: w.err })) },
});

describe("sendLeadReply (HR inbox reply)", () => {
  it("sends through Pinbot first and does not touch Wassenger when Pinbot succeeds", async () => {
    const d = deps({ conf: true, ok: true }, { conf: true, ok: true });
    expect(await sendLeadReply("9876543210", "hi", d)).toEqual({ success: true, provider: "pinbot", messageId: "pb-1" });
    expect(d.wassenger.send).not.toHaveBeenCalled();
  });

  it("falls back to Wassenger when Pinbot fails", async () => {
    const d = deps({ conf: true, ok: false, err: "boom" }, { conf: true, ok: true });
    expect(await sendLeadReply("9876543210", "hi", d)).toMatchObject({ success: true, provider: "wassenger", messageId: "ws-1" });
  });

  it("explains the closed 24-hour window instead of Meta's raw code", async () => {
    const d = deps({ conf: true, ok: false, err: "(#131047) Re-engagement message" }, { conf: false });
    const r = await sendLeadReply("9876543210", "hi", d);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/last 24 hours/);
  });

  it("reports both failures when both providers fail, and none configured as its own error", async () => {
    const both = await sendLeadReply("1", "hi", deps({ conf: true, ok: false, err: "a" }, { conf: true, ok: false, err: "no device" }));
    expect(both.error).toBe("Pinbot: a | Wassenger: no device");
    const none = deps({ conf: false }, { conf: false });
    expect(anyReplyProviderConfigured(none)).toBe(false);
    expect((await sendLeadReply("1", "hi", none)).error).toMatch(/No WhatsApp provider/);
  });
});
