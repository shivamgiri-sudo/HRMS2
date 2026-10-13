import { describe, expect, it } from "vitest";
import { classifyBotRow, isBotReport, parseBotDialTime, parseResultRows } from "../he-call-results.js";

const H = ["Phone Number", "Name", "Role", "Call Dial Time", "Unique Call Id", "Disposition", "Outcome", "Status", "Reference ID", "Walkin Interview Attendance"];
const row = (o: Record<string, string>) => ({ "Phone Number": "9876543210", Name: "A", Role: "EXECUTIVE", "Call Dial Time": "7th Oct 2026 04:13 PM", "Unique Call Id": "c1", Disposition: "", Outcome: "disposed", Status: "answered", "Reference ID": "HRMS-188", "Walkin Interview Attendance": "-", ...o });

describe("calling tool report", () => {
  it("is recognised by its attendance column", () => { expect(isBotReport(H)).toBe(true); expect(isBotReport(["phone", "result"])).toBe(false); });
  it("reads the dial time as IST wall clock", () => {
    expect(parseBotDialTime("7th Oct 2026 04:13 PM")).toBe("2026-10-07 16:13:00");
    expect(parseBotDialTime("22nd Oct 2026 12:05 AM")).toBe("2026-10-22 00:05:00");
    expect(parseBotDialTime("garbage")).toBeUndefined();
  });
  it("will attend / will not attend / attendance column decide", () => {
    const v = (disposition: string, attendance = "-") => classifyBotRow({ disposition, attendance, outcome: "disposed", status: "answered" });
    expect(v("WILL ATTEND WALK-IN INTERVIEW")).toEqual({ outcome: "WALKIN_CONFIRMED_YES", undecided: false });
    expect(v("WILL NOT ATTEND WALK-IN INTERVIEW")).toEqual({ outcome: "WALKIN_DECLINED_NEEDS_FOLLOWUP", undecided: false });
    expect(v("EMAIL RECEIVED", "yes")?.outcome).toBe("WALKIN_CONFIRMED_YES");
    expect(v("ONLY NAME VERIFIED", "no")?.outcome).toBe("WALKIN_DECLINED_NEEDS_FOLLOWUP");
  });
  it("bot steps without a decision are answered, undecided", () => {
    for (const d of ["EMAIL RECEIVED", "ONLY NAME VERIFIED", "DETAILS FILLED", "DETAILS NOT FILLED", "NAME NOT VERIFIED", "INTERESTED TO TALK TO AN EXPERT", "CALLBACK REQUESTED", "CALLBACK DETAILS NOT SHARED", "UNCERTAIN ABOUT ATTENDING WALK-IN INTERVIEW"]) {
      expect(classifyBotRow({ disposition: d, attendance: "-", outcome: "disposed", status: "answered" }), d).toEqual({ outcome: "WALKIN_DECLINED_NEEDS_FOLLOWUP", undecided: true });
    }
  });
  it("interested to talk to an expert is never read as confirmed", () => {
    expect(classifyBotRow({ disposition: "INTERESTED TO TALK TO AN EXPERT", attendance: "-", outcome: "disposed", status: "answered" })?.outcome).not.toBe("WALKIN_CONFIRMED_YES");
  });
  it("empty disposition: abandoned = no answer, failed = call failed", () => {
    expect(classifyBotRow({ disposition: "", attendance: "-", outcome: "abandoned", status: "answered" })?.outcome).toBe("NO_ANSWER");
    expect(classifyBotRow({ disposition: "", attendance: "-", outcome: "", status: "failed" })?.outcome).toBe("CALL_FAILED");
  });
  it("a whole file parses with no rejected rows and keeps the reference and time", () => {
    const rows = [row({ Disposition: "WILL ATTEND WALK-IN INTERVIEW", "Walkin Interview Attendance": "yes" }), row({ "Unique Call Id": "c2", Disposition: "EMAIL RECEIVED" }), row({ "Unique Call Id": "c3", Outcome: "abandoned" })];
    const p = parseResultRows(rows);
    expect(p.missingColumns).toEqual([]);
    expect(p.rows.every((r) => r.ok)).toBe(true);
    expect(p.rows.map((r) => r.outcome)).toEqual(["WALKIN_CONFIRMED_YES", "WALKIN_DECLINED_NEEDS_FOLLOWUP", "NO_ANSWER"]);
    expect(p.rows[0].referenceId).toBe("HRMS-188");
    expect(p.rows[0].startedAt).toBe("2026-10-07 16:13:00");
    expect(p.rows[1].undecided).toBe(true);
    expect(p.rows[0].callId).toBe("c1");
  });
  it("a generic (non-bot) file still uses the text rules", () => {
    const p = parseResultRows([{ phone: "9876543210", result: "confirmed" }]);
    expect(p.rows[0].outcome).toBe("WALKIN_CONFIRMED_YES");
    expect(p.rows[0].undecided).toBe(false);
  });
});
