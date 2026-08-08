/**
 * Do not attempt a channel whose provider has no credentials.
 *
 * Measured on production, all time to 2026-08-08:
 *
 *     email     907 sent    4 failed
 *     sms         0 sent  901 failed
 *     whatsapp    0 sent  903 failed
 *
 * Neither SMS nor WhatsApp has EVER delivered a message — the credentials were
 * never supplied. Every critical event fans out to all three channels, so each
 * notification minted two rows that could only fail. 1,804 of dispatch_log's
 * 2,740 rows, 66%, are that noise, and a genuine SMS failure would be
 * indistinguishable inside it.
 *
 * The safety argument is that this is provably lossless: a channel with zero
 * successes across its entire history loses nothing by not being attempted.
 *
 * The trap avoided: communication_provider_config.is_enabled is NOT an on/off
 * switch. loadActiveConfig returns null when it is 0, and the factory then
 * builds from env — all three channels are is_enabled = 0 today, and email works
 * *because* of that fallback. Treating that flag as "channel is on" would have
 * silenced the only channel that delivers.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const providersDir = path.resolve(__dirname, "../providers");
const dispatchSrc = fs.readFileSync(path.resolve(__dirname, "../dispatch.service.ts"), "utf8");

const read = (rel: string) => fs.readFileSync(path.join(providersDir, rel), "utf8");

describe("provider capability check", () => {
  it("is declared OPTIONAL on the interface", () => {
    // Optional is what makes this incapable of touching email: a provider that
    // does not implement it is treated as configured.
    expect(read("provider.interface.ts")).toMatch(/isConfigured\?\(\): boolean;/);
  });

  it("no EMAIL provider implements it — the working channel is untouchable", () => {
    for (const f of fs.readdirSync(path.join(providersDir, "email"))) {
      expect(read(`email/${f}`), `${f} must not opt in`).not.toContain("isConfigured");
    }
  });

  it("every credentialed SMS and WhatsApp provider implements it", () => {
    const expected = [
      "sms/twilio-sms.provider.ts",
      "sms/smartping.provider.ts",
      "sms/msg91.provider.ts",
      "whatsapp/twilio-whatsapp.provider.ts",
      "whatsapp/meta.provider.ts",
    ];
    for (const rel of expected) {
      expect(read(rel), `${rel} does not report configuration`).toContain("isConfigured()");
    }
  });

  it("each check requires the credential that actually gates sending", () => {
    // SmartPing's live failure was literally "username is required".
    expect(read("sms/smartping.provider.ts")).toContain("this.username && this.password");
    expect(read("sms/twilio-sms.provider.ts")).toContain("Boolean(sid && tok && this.sid)");
    expect(read("whatsapp/meta.provider.ts")).toContain("this.accessToken && this.phoneNumberId");
  });
});

describe("dispatch skips unconfigured channels", () => {
  const code = dispatchSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("checks before building a dispatch_log row", () => {
    const guard = code.indexOf("channelUnconfigured(channel)");
    const insert = code.indexOf("INSERT INTO dispatch_log");
    expect(guard).toBeGreaterThan(-1);
    expect(guard, "the row is written before the check, so noise is still logged").toBeLessThan(insert);
  });

  it("counts the skip as failed rather than pretending it was sent", () => {
    const guard = code.slice(code.indexOf("channelUnconfigured(channel)"));
    expect(guard.slice(0, 200)).toContain("failed.push");
  });

  it("fails to FALSE — a misjudgement degrades to today's behaviour, never to silence", () => {
    const fn = code.slice(code.indexOf("private async channelUnconfigured"));
    const body = fn.slice(0, fn.indexOf("\n  private plainText"));
    expect(body).toContain("catch");
    expect(body).toMatch(/catch[\s\S]{0,80}return false/);
    // A provider that does not implement the method is configured by default.
    expect(body).toMatch(/typeof provider\.isConfigured !== 'function'[\s\S]{0,40}return false/);
  });

  it("warns once per channel, not once per message", () => {
    // Logging per message would recreate the very noise this removes.
    expect(code).toContain("unconfiguredWarned");
    const fn = code.slice(code.indexOf("private async channelUnconfigured"));
    expect(fn.slice(0, 900)).toContain("unconfiguredWarned.has(channel)");
  });
});
