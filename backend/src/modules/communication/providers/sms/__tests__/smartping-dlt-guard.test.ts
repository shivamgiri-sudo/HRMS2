/**
 * SmartPing must not be handed a subject line where a DLT template id belongs.
 *
 * The provider's second parameter is called `subject` to satisfy
 * CommunicationProvider, but SmartPing reads it as dltContentId. sms.helper does
 * the right thing — buildSMS() returns { body, dltContentId } from
 * SMARTPING_DLT_REGISTRY and it passes the id. dispatchService does not: it
 * passes dispatch_log.subject, so every notification SMS sent something like
 * "eSign link expiring — employee non-responsive" as the template id.
 *
 * Result on production, all time: SMS 0 sent / 901 failed, every one
 * "Request failed with status code 400". The credentials were fine —
 * SMARTPING_USERNAME, _PASSWORD and _SENDER_ID are all set — which is why the
 * unconfigured-channel skip correctly does NOT suppress this channel.
 *
 * Failing early rather than at the gateway is deliberate:
 *   - the recorded error becomes accurate; "400" explained nothing for months;
 *   - it stops pointless HTTP calls per message;
 *   - under TRAI DLT rules the text must MATCH its registered template, so
 *     sending arbitrary notification content is a compliance issue, not just a
 *     failed send.
 *
 * The legitimate OTP path must keep working — that is the property most worth
 * protecting here, since it gates login.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: { get: vi.fn(async () => ({ status: 200, data: { messageId: "sent-123" } })) },
}));

const axios = (await import("axios")).default as unknown as { get: ReturnType<typeof vi.fn> };
const { SmartPingProvider } = await import("../smartping.provider.js");
const { SMARTPING_DLT_REGISTRY } = await import("../../../smartping-dlt-registry.js");

const provider = new SmartPingProvider("user", "pass", "Ispark", "1001485540000016211");
const MOBILE = "9999746258";

describe("SmartPing DLT template guard", () => {
  it("refuses a human subject line instead of firing a doomed request", async () => {
    axios.get.mockClear();
    const res = await provider.send(MOBILE, "eSign link expiring — employee non-responsive", "body");

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/No registered DLT template/);
    expect(axios.get, "it should not reach the gateway at all").not.toHaveBeenCalled();
  });

  it("says what was actually received, so the log is diagnosable", async () => {
    const res = await provider.send(MOBILE, "Joining document eSign pending", "body");
    expect(res.error).toContain("Joining document eSign pending");
    expect(res.error).toContain("buildSMS");
  });

  it("still sends when given a real registry template id — the OTP path", async () => {
    axios.get.mockClear();
    const otp = SMARTPING_DLT_REGISTRY.hrms_login_otp;
    expect(otp?.dltContentId, "registry template missing").toBeTruthy();

    const res = await provider.send(MOBILE, otp.dltContentId, "Your OTP is 123456");

    expect(res.success, "login OTP must not be broken by this guard").toBe(true);
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it("every id in the registry passes the guard", async () => {
    // If the shape check were too strict it would silently break real templates.
    for (const [name, tpl] of Object.entries(SMARTPING_DLT_REGISTRY)) {
      axios.get.mockClear();
      const res = await provider.send(MOBILE, (tpl as { dltContentId: string }).dltContentId, "x");
      expect(res.success, `${name} was rejected by the guard`).toBe(true);
    }
  });

  it("rejects an empty id rather than sending without one", async () => {
    axios.get.mockClear();
    const res = await provider.send(MOBILE, "", "body");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/nothing/);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
