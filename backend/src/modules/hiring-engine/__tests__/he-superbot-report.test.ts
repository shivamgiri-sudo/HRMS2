import { describe, expect, it } from "vitest";
import { callOutcome } from "../he-signals.js";
import { mapSuperbotFeedback } from "../he-superbot.js";
import { parseDialTime, reportRowToFeedback } from "../he-superbot-report.js";

const row = (o: Record<string, string>) => ({ "Phone Number": "8955312159", "Call Dial Time": "7th Oct 2026 04:14 PM", "Unique Call Id": "u-1", "Retry Count": "1", "Duration(s)": "89.74", Disposition: "", Outcome: "disposed", Status: "answered", "Reference ID": "HRMS-185", "Name Confirmation": "-", "Good Time to Talk": "-", "Email Received": "-", "Details Filled": "-", "Walkin Interview Attendance": "-", "Talk to HR": "-", "Callback Details": "-", "Callback Request": "-", "Already Done": "-", "Not Applied": "-", ...o });
const map = (o: Record<string, string>) => mapSuperbotFeedback(reportRowToFeedback(row(o))!.feedback);

describe("Superbot report upload", () => {
  it("reads the portal's dial time", () => {
    expect(parseDialTime("7th Oct 2026 04:13 PM")).toBe("2026-10-07 16:13:00");
    expect(parseDialTime("21st Oct 2026 12:05 AM")).toBe("2026-10-21 00:05:00");
    expect(parseDialTime("garbage")).toBeNull();
  });
  it("will attend -> confirmed", () => {
    const m = map({ Disposition: "WILL ATTEND WALK-IN INTERVIEW", "Name Confirmation": "yes", "Email Received": "yes", "Walkin Interview Attendance": "yes" });
    expect(callOutcome(m.result)).toBe("WALKIN_CONFIRMED_YES");
    expect(m.incomplete).toBe(false);
  });
  it("only name verified / email received -> recorded, never declined", () => {
    for (const d of [{ Disposition: "ONLY NAME VERIFIED", "Name Confirmation": "yes" }, { Disposition: "EMAIL RECEIVED", "Name Confirmation": "yes", "Email Received": "yes", "Good Time to Talk": "yes" }, { Disposition: "DETAILS FILLED", "Name Confirmation": "yes", "Details Filled": "yes" }]) {
      const m = map(d);
      expect(m.incomplete).toBe(true);
      expect(m.humanFollowUp).toMatch(/ended before the walk-in question/);
    }
  });
  it("will not attend -> declined hand-off", () => {
    const m = map({ Disposition: "WILL NOT ATTEND WALK-IN INTERVIEW", "Name Confirmation": "yes", "Walkin Interview Attendance": "no" });
    expect(callOutcome(m.result)).toBe("WALKIN_DECLINED_NEEDS_FOLLOWUP");
    expect(m.incomplete).toBe(false);
  });
  it("name not verified -> wrong person; abandoned -> not reached", () => {
    expect(callOutcome(map({ Disposition: "NAME NOT VERIFIED", "Name Confirmation": "no" }).result)).toBe("WRONG_PERSON_REACHED");
    const a = map({ Outcome: "abandoned" });
    expect(callOutcome(a.result)).toBe("NO_ANSWER");
    expect(a.incomplete).toBe(false);
  });
  it("wants an expert / callback -> human follow-up", () => {
    const m = map({ Disposition: "CALLBACK DETAILS NOT SHARED", "Name Confirmation": "yes", "Email Received": "yes", "Details Filled": "no", "Walkin Interview Attendance": "no", "Talk to HR": "no", "Callback Details": "not_shared", "Callback Request": "yes" });
    expect(m.humanFollowUp).toMatch(/callback requested/);
  });
  it("uses the portal's unique call id and phone, and skips empty rows", () => {
    const r = reportRowToFeedback(row({}))!;
    expect(r.uniqueCallId).toBe("u-1"); expect(r.phone10).toBe("8955312159"); expect(r.dialTime).toBe("2026-10-07 16:14:00");
    expect(reportRowToFeedback({ Name: "x" })).toBeNull();
  });
});
