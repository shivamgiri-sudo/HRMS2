/**
 * Leave rejection SMS used an unregistered DLT template key — same bug class as
 * otp-sms-dlt.contract.test.ts / onboarding-link-sms-dlt.contract.test.ts, but the OTHER
 * direction: this one wasn't a human label where an id belongs, it was a template KEY that
 * simply doesn't exist in the registry at all.
 *
 * WHY THIS EXISTS
 *   leave.service.ts's reviewRequest() called sendSMS(phone, 'request_rejected', {...}) on
 *   every leave rejection. SMARTPING_DLT_REGISTRY has no 'request_rejected' key — only
 *   'request_approved' — so buildSMS() threw "Unknown SmartPing DLT template key" on every
 *   call, caught inside sms.helper.ts's try/catch and logged, never surfaced. Approval SMS
 *   (leave_approved) has always worked; rejection SMS never has. Found 2026-08-18 investigating
 *   why SMS "wasn't working" for HR events broadly.
 *
 *   request_approved is NOT a safe substitute: its registered text hardcodes the word
 *   "approved" ("your {request_type} request has been approved by {approver_name}"), so using
 *   it for a rejection would tell the employee the opposite of what happened. No registered
 *   template exists for a rejection, so the fix is to stop attempting it (same "skip, don't
 *   guess" pattern as event-sms-template-map.ts), not to find a different key.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SMARTPING_DLT_REGISTRY } from "../../communication/smartping-dlt-registry.js";

const source = readFileSync(resolve(process.cwd(), "src/modules/leave/leave.service.ts"), "utf8");
// The fix's own explanatory comment mentions the old sendSMS(phone, 'request_rejected', ...)
// call by name (that's the point — it documents what NOT to do and why) — strip // comment
// lines before regex-checking for real code, or that documentation trips the very check it's
// explaining.
const codeOnly = source.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");

describe("leave rejection no longer attempts an unregistered DLT template", () => {
  it("'request_rejected' is not a registered template — documents why the old code always failed", () => {
    expect(
      Object.prototype.hasOwnProperty.call(SMARTPING_DLT_REGISTRY, "request_rejected"),
      "if this ever becomes true, leave.service.ts should be updated to use it instead of skipping",
    ).toBe(false);
  });

  it("no longer calls sendSMS with the unregistered 'request_rejected' key", () => {
    expect(/sendSMS\([^)]*['"]request_rejected['"]/.test(codeOnly)).toBe(false);
  });

  it("does not reuse request_approved's template for a rejection (it hardcodes the word 'approved')", () => {
    const approvedTpl = SMARTPING_DLT_REGISTRY.request_approved;
    expect(approvedTpl.registeredText.toLowerCase()).toContain("approved");
    // If leave.service.ts's rejection branch ever calls sendSMS at all, it must not be with
    // request_approved's key — that would send a factually wrong message.
    const rejectionBranch = source.slice(source.indexOf("input.status === 'rejected'"));
    const nextFewLines = rejectionBranch.slice(0, rejectionBranch.indexOf("}") + 1);
    expect(/sendSMS\([^)]*['"]request_approved['"]/.test(nextFewLines)).toBe(false);
  });

  it("approval SMS is untouched — still uses the real registered leave_approved template", () => {
    expect(/sendSMS\(\s*phone\s*,\s*['"]leave_approved['"]/.test(source)).toBe(true);
    const approvedTpl = SMARTPING_DLT_REGISTRY.leave_approved;
    expect(approvedTpl.dltContentId).toMatch(/^\d{12,25}$/);
  });
});
