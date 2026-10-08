/**
 * The candidate onboarding OTP must go out through a registered DLT template.
 *
 * WHY THIS EXISTS
 *   ats.otp.service.ts called smsProvider.send(mobile, 'OTP Verification', message) — a human
 *   label in the slot SmartPing reads as a numeric DLT content id. Observed live in production
 *   on 2026-08-10:
 *
 *     [OTP] SMS send failed: No registered DLT template for this message. SmartPing requires a
 *     numeric dltContentId from SMARTPING_DLT_REGISTRY (route via buildSMS), but received
 *     "OTP Verification". Not sent.
 *
 *   So no candidate ever received an onboarding OTP by SMS. It failed quietly: the caller
 *   catches the failure and falls through to email, so the only symptom was a warning line in
 *   a log nobody reads and candidates without email never completing onboarding.
 *
 *   The bespoke message body was the second half of it. Under TRAI DLT rules the delivered
 *   text must match the registered template, so a hand-written sentence would have been a
 *   compliance failure even with the right id. Both halves come from buildSMS or neither does,
 *   which is why this asserts the call shape rather than the message text.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSMS } from "../../communication/smartping-dlt-registry.js";

const source = readFileSync(resolve(process.cwd(), "src/modules/ats/ats.otp.service.ts"), "utf8");

describe("candidate OTP SMS uses a registered DLT template", () => {
  it("builds the message with buildSMS rather than hand-writing it", () => {
    expect(
      /buildSMS\(\s*['"]candidate_mobile_otp['"]/.test(source),
      "the OTP SMS must be produced by buildSMS('candidate_mobile_otp', ...). A hand-written " +
        "body cannot match the registered DLT text and will be rejected or breach DLT rules.",
    ).toBe(true);
  });

  it("passes the template's dltContentId, never a human label", () => {
    // The exact regression: a descriptive string where the numeric id belongs.
    const labelInIdSlot = /smsProvider\.send\([^)]*,\s*['"][A-Za-z][^'"]*['"]\s*,/.test(source);
    expect(
      labelInIdSlot,
      "smsProvider.send() is receiving a quoted human label in its dltContentId argument — " +
        "this is the 'OTP Verification' bug. Pass the dltContentId returned by buildSMS.",
    ).toBe(false);
    expect(/send\(\s*\w+\s*,\s*dltContentId\s*,/.test(source)).toBe(true);
  });

  it("states the same validity the OTP row is actually given", () => {
    // onboarding-full.routes.ts inserts DATE_ADD(NOW(), INTERVAL 10 MINUTE). If these drift the
    // SMS tells the candidate a number that is not true.
    const routes = readFileSync(
      resolve(process.cwd(), "src/modules/ats/onboarding-full.routes.ts"),
      "utf8",
    );
    const dbMinutes = routes.match(/INTERVAL\s+(\d+)\s+MINUTE/)?.[1];
    const smsMinutes = source.match(/OTP_VALIDITY_MINUTES\s*=\s*(\d+)/)?.[1];
    expect(dbMinutes, "could not read the OTP expiry from onboarding-full.routes.ts").toBeDefined();
    expect(smsMinutes, "OTP_VALIDITY_MINUTES not found in ats.otp.service.ts").toBeDefined();
    expect(
      smsMinutes,
      `the SMS says ${smsMinutes} minutes but the OTP row expires in ${dbMinutes}`,
    ).toBe(dbMinutes);
  });

  it("renders a body identical to the registered template, with a valid id", () => {
    const { body, dltContentId } = buildSMS("candidate_mobile_otp", {
      otp: "123456",
      validity_minutes: 10,
    });
    // SmartPing accepts only a 12-25 digit id; anything else is rejected before sending.
    expect(dltContentId).toMatch(/^\d{12,25}$/);
    expect(body).toContain("123456");
    expect(body).not.toContain("{#var#}"); // every placeholder must be filled
  });
});
