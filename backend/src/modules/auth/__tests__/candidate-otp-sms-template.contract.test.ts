/**
 * candidate-onboarding.service.ts called the shared sendOtpSms() helper with no way to say
 * "this is a candidate, not an HRMS login" — the helper hardcoded 'hrms_login_otp' for every
 * caller, so a candidate verifying their mobile for onboarding received an SMS reading "Your
 * OTP for HRMS login is..." even though they were never logging into HRMS. Not a delivery
 * failure (both hrms_login_otp and candidate_mobile_otp are validly registered templates, so
 * it sent fine) — a content-accuracy bug, fixed by making the template key an explicit
 * parameter and having each real caller state its own context.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSMS } from "../../communication/smartping-dlt-registry.js";

const helperSource = readFileSync(resolve(process.cwd(), "src/modules/auth/sms.helper.ts"), "utf8");
const candidateSource = readFileSync(
  resolve(process.cwd(), "src/modules/candidate-onboarding/candidate-onboarding.service.ts"),
  "utf8",
);
const twoFactorSource = readFileSync(resolve(process.cwd(), "src/modules/auth/twoFactor.service.ts"), "utf8");

describe("candidate onboarding OTP uses its own registered template, not the login one", () => {
  it("candidate-onboarding.service.ts explicitly requests candidate_mobile_otp", () => {
    expect(/sendOtpSms\(\s*mobile\s*,\s*code\s*,\s*['"]candidate_mobile_otp['"]/.test(candidateSource)).toBe(true);
  });

  it("twoFactor.service.ts (a genuine login OTP) is untouched — still gets hrms_login_otp via the default", () => {
    // twoFactor.service.ts should NOT need to change at all: sendOtpSms(recipient, code) with
    // no third argument, relying on the helper's default template staying 'hrms_login_otp'.
    expect(/sendOtpSms\(\s*recipient\s*,\s*code\s*\)/.test(twoFactorSource)).toBe(true);
    expect(/templateKey:.*=\s*['"]hrms_login_otp['"]/.test(helperSource)).toBe(true);
  });

  it("both templates render real, valid, distinct SmartPing DLT ids and text", () => {
    const login = buildSMS("hrms_login_otp", { otp: "123456", validity_minutes: 10 });
    const candidate = buildSMS("candidate_mobile_otp", { otp: "123456", validity_minutes: 10 });
    expect(login.dltContentId).toMatch(/^\d{12,25}$/);
    expect(candidate.dltContentId).toMatch(/^\d{12,25}$/);
    expect(login.dltContentId).not.toBe(candidate.dltContentId);
    expect(candidate.body.toLowerCase()).toContain("candidate onboarding");
    expect(login.body.toLowerCase()).not.toContain("candidate onboarding");
  });

  it("candidate OTP validity is a real parameter now, not a value independent of the caller's own expiry", () => {
    // The exact bug pattern otp-sms-dlt.contract.test.ts guards against for ats.otp.service.ts —
    // a hardcoded '10' baked into the shared helper, disconnected from whatever the caller
    // actually sets as the OTP row's real expiry.
    expect(/validityMinutes/.test(helperSource)).toBe(true);
    expect(/sendOtpSms\(\s*mobile\s*,\s*code\s*,\s*['"]candidate_mobile_otp['"]\s*,\s*OTP_TTL_MINUTES\s*\)/.test(candidateSource)).toBe(true);
  });
});
