/**
 * The onboarding OTP must go out over SMS and email on every request — not
 * a fallback chain.
 *
 * WHY THIS EXISTS
 *   sendOnboardingOtp() (formerly sendOnboardingOtpViaSms) used to try SMS
 *   once and only send the email if that attempt failed. As long as SMS
 *   failed for ANY reason — a transient provider error, a format quirk, a
 *   misconfigured provider row — email silently took over and the
 *   candidate's phone got nothing, which is exactly the "OTP only arrives
 *   by email" symptom this fix addresses. Both channels are now attempted
 *   independently and unconditionally.
 *
 *   The regression this guards against is subtle: it's easy to "simplify"
 *   this back into an if/else fallback during a later edit without
 *   realising it silently reintroduces the bug. This asserts the email send
 *   is NOT nested inside any SMS-failure branch.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/modules/ats/ats.otp.service.ts"), "utf8");
const routesSource = readFileSync(resolve(process.cwd(), "src/modules/ats/onboarding-full.routes.ts"), "utf8");

describe("onboarding OTP sends via SMS and email unconditionally, not as a fallback", () => {
  it("the exported function reflects dual-send, not the old ViaSms fallback name", () => {
    expect(source).toContain("export async function sendOnboardingOtp(");
    expect(source).not.toContain("sendOnboardingOtpViaSms");
  });

  it("the email send is not gated on smsSuccess or nested inside the SMS try/catch", () => {
    const fn = source.slice(source.indexOf("export async function sendOnboardingOtp("));
    const emailBlockStart = fn.indexOf("Always attempted, regardless of the SMS outcome");
    expect(emailBlockStart).toBeGreaterThan(-1);
    // The SMS section's own catch block (the one guarding smsProvider work) must
    // close before the email block begins — i.e. email is a sibling statement,
    // not nested inside the SMS try/catch.
    const smsCatchIdx = fn.indexOf("catch (err) {\n      smsError");
    expect(smsCatchIdx).toBeGreaterThan(-1);
    expect(smsCatchIdx).toBeLessThan(emailBlockStart);
    // And the email send must not be conditioned on smsSuccess being false —
    // that would silently reintroduce the fallback-chain bug.
    const emailBlock = fn.slice(emailBlockStart);
    expect(emailBlock).not.toMatch(/if\s*\(\s*!smsSuccess/);
  });

  it("returns per-channel outcomes, not a single winning channel", () => {
    expect(source).toContain("smsSuccess");
    expect(source).toContain("emailSuccess");
    expect(source).toContain("success: smsSuccess || emailSuccess");
  });

  it("the route calls the renamed function and reports both channels", () => {
    expect(routesSource).toContain("sendOnboardingOtp");
    expect(routesSource).not.toContain("sendOnboardingOtpViaSms");
    expect(routesSource).toContain("smsDelivered");
    expect(routesSource).toContain("emailDelivered");
  });
});
