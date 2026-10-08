import { describe, expect, it } from "vitest";
import {
  CLIENT_DEVICE_GUARD_SNIPPET,
  deviceBlockMessage,
  isBlockedDeviceUserAgent,
  isDeviceGateEnabled,
  MOBILE_UA_PATTERN_SOURCE,
} from "../device-guard.js";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD_MOBILE_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
// iPadOS Safari's default "Request Desktop" mode — indistinguishable from a real
// Mac by UA string alone. Documented, accepted gap (see device-guard.ts).
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const LINUX_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0";

describe("device-guard: isBlockedDeviceUserAgent", () => {
  it("blocks real phone browsers", () => {
    expect(isBlockedDeviceUserAgent(ANDROID_CHROME)).toBe(true);
    expect(isBlockedDeviceUserAgent(IPHONE_SAFARI)).toBe(true);
  });

  it("blocks an iPad in classic mobile-Safari UA mode", () => {
    expect(isBlockedDeviceUserAgent(IPAD_MOBILE_SAFARI)).toBe(true);
  });

  it("does NOT block an iPad presenting a desktop UA — documented gap, not a bug", () => {
    expect(isBlockedDeviceUserAgent(IPAD_DESKTOP_UA)).toBe(false);
  });

  it("does not block ordinary desktop browsers", () => {
    expect(isBlockedDeviceUserAgent(WINDOWS_CHROME)).toBe(false);
    expect(isBlockedDeviceUserAgent(MAC_SAFARI)).toBe(false);
    expect(isBlockedDeviceUserAgent(LINUX_FIREFOX)).toBe(false);
  });

  it("fails open (does not block) on a missing/empty user agent", () => {
    expect(isBlockedDeviceUserAgent(null)).toBe(false);
    expect(isBlockedDeviceUserAgent(undefined)).toBe(false);
    expect(isBlockedDeviceUserAgent("")).toBe(false);
  });
});

describe("device-guard: isDeviceGateEnabled", () => {
  it("defaults to enabled when the env var is unset", () => {
    const original = process.env.ATS_ASSESSMENT_DEVICE_GATE_ENABLED;
    delete process.env.ATS_ASSESSMENT_DEVICE_GATE_ENABLED;
    expect(isDeviceGateEnabled()).toBe(true);
    if (original !== undefined) process.env.ATS_ASSESSMENT_DEVICE_GATE_ENABLED = original;
  });

  it("is a working kill switch when explicitly set to false", () => {
    const original = process.env.ATS_ASSESSMENT_DEVICE_GATE_ENABLED;
    process.env.ATS_ASSESSMENT_DEVICE_GATE_ENABLED = "false";
    expect(isDeviceGateEnabled()).toBe(false);
    if (original === undefined) delete process.env.ATS_ASSESSMENT_DEVICE_GATE_ENABLED;
    else process.env.ATS_ASSESSMENT_DEVICE_GATE_ENABLED = original;
  });
});

describe("device-guard: deviceBlockMessage", () => {
  it("personalizes with a recruiter name and mobile when both are known", () => {
    const message = deviceBlockMessage("Priya Sharma", "9876543210");
    expect(message).toContain("Priya Sharma");
    expect(message).toContain("9876543210");
  });

  it("falls back to a generic instruction without fabricating a contact", () => {
    const message = deviceBlockMessage(null, null);
    expect(message).toContain("Contact the recruiter who registered you");
    expect(message).not.toMatch(/\d{5,}/); // no fabricated phone number
  });
});

describe("device-guard: CLIENT_DEVICE_GUARD_SNIPPET", () => {
  it("is syntactically valid standalone JS and defines isBlockedDevice()", () => {
    expect(() => new Function(CLIENT_DEVICE_GUARD_SNIPPET)).not.toThrow();
    expect(CLIENT_DEVICE_GUARD_SNIPPET).toContain("isBlockedDevice");
  });

  it("embeds the exact same pattern source the server uses, so the two can never disagree", () => {
    expect(CLIENT_DEVICE_GUARD_SNIPPET).toContain(JSON.stringify(MOBILE_UA_PATTERN_SOURCE));
  });
});
