/**
 * The onboarding-link SMS fallback (walk-in candidates with a mobile but no email) must go
 * out through a registered DLT template — same bug class as otp-sms-dlt.contract.test.ts.
 *
 * WHY THIS EXISTS
 *   sendOnboardingToken() (ats.onboarding.service.ts) called
 *   smsProvider.send(cand.mobile, 'Onboarding Link', smsBody) — a human label in the slot
 *   SmartPing reads as a numeric DLT content id, and a hand-written body that could never match
 *   a registered template even with a valid id. Every SMS this function sent was rejected;
 *   found and fixed 2026-08-18 alongside the equivalent dispatch.service.ts bug.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSMS } from "../../communication/smartping-dlt-registry.js";

const source = readFileSync(resolve(process.cwd(), "src/modules/ats/ats.onboarding.service.ts"), "utf8");

describe("onboarding-link SMS uses a registered DLT template", () => {
  it("builds the SMS with buildSMS rather than hand-writing it", () => {
    expect(
      /buildSMS\(\s*['"]onboarding_link['"]/.test(source),
      "the onboarding-link SMS must be produced by buildSMS('onboarding_link', ...). A " +
        "hand-written body cannot match the registered DLT text and will be rejected or breach " +
        "DLT rules.",
    ).toBe(true);
  });

  it("passes the template's dltContentId to smsProvider.send, never a human label", () => {
    // The exact regression: a descriptive string ('Onboarding Link') where the numeric id belongs.
    const labelInIdSlot = /smsProvider\.send\([^)]*,\s*['"][A-Za-z][^'"]*['"]\s*,/.test(source);
    expect(
      labelInIdSlot,
      "smsProvider.send() is receiving a quoted human label in its dltContentId argument — " +
        "this is the 'Onboarding Link' bug. Pass the dltContentId returned by buildSMS.",
    ).toBe(false);
    expect(/smsProvider\.send\(\s*cand\.mobile\s*,\s*dltContentId\s*,/.test(source)).toBe(true);
  });

  it("renders a body identical to the registered template, with a valid id", () => {
    const { body, dltContentId } = buildSMS("onboarding_link", { name: "Test Candidate" });
    // SmartPing accepts only a 12-25 digit id; anything else is rejected before sending.
    expect(dltContentId).toMatch(/^\d{12,25}$/);
    expect(body).toContain("Test Candidate");
    expect(body).not.toContain("{#var#}"); // every placeholder must be filled
  });

  it("the onboarding-progress-reminder SMS is not attempted at all — no matching DLT template exists", () => {
    // sendOnboardingProgressReminder had the identical bug (smsProvider.send(row.mobile,
    // 'Onboarding Reminder', whatsappBody)), found while writing this test. Unlike
    // onboarding_link, its content is per-step dynamic and matches no registered template, so
    // the fix is to stop attempting it, not to route it through buildSMS with a wrong template.
    expect(/smsProvider\.send\([^)]*['"]Onboarding Reminder['"]/.test(source)).toBe(false);
    expect(/no registered DLT template for onboarding reminders/i.test(source)).toBe(true);
  });

  it("does not attempt the equivalent fix on the WhatsApp send in the same block", () => {
    // Deliberate scope boundary, not an oversight: WhatsApp isn't DLT-regulated the way SMS is,
    // and this fix is specifically about the SMS DLT bug. Documents the boundary so a future
    // reader doesn't assume waProvider.send's free-text body was missed by accident.
    expect(/waProvider\.send\(\s*cand\.mobile\s*,\s*['"]Onboarding Link['"]/.test(source)).toBe(true);
  });
});
