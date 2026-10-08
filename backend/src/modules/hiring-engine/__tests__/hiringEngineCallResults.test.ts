import { describe, expect, it } from "vitest";
import { classifyOutcome, mapResultHeaders, parseResultRows } from "../he-call-results.js";

describe("classifyOutcome", () => {
  it.each([
    ["Confirmed", "WALKIN_CONFIRMED_YES"], ["Walk-in confirmed", "WALKIN_CONFIRMED_YES"], ["Yes, will come", "WALKIN_CONFIRMED_YES"], ["Interested", "WALKIN_CONFIRMED_YES"], ["haan aaunga", "WALKIN_CONFIRMED_YES"],
    ["Rescheduled", "WALKIN_RESCHEDULED"], ["wants another day", "WALKIN_RESCHEDULED"], ["Reschedule requested", "WALKIN_RESCHEDULED"],
    ["Declined", "WALKIN_DECLINED_NEEDS_FOLLOWUP"], ["Not interested", "WALKIN_DECLINED_NEEDS_FOLLOWUP"], ["cannot come", "WALKIN_DECLINED_NEEDS_FOLLOWUP"], ["No", "WALKIN_DECLINED_NEEDS_FOLLOWUP"],
    ["No answer", "NO_ANSWER"], ["Not picked", "NO_ANSWER"], ["Busy", "NO_ANSWER"], ["Voicemail", "NO_ANSWER"],
    ["Wrong number", "WRONG_PERSON_REACHED"], ["wrong person", "WRONG_PERSON_REACHED"],
    ["Invalid number", "CALL_FAILED"], ["Switched off", "CALL_FAILED"], ["Disconnected", "CALL_FAILED"], ["DND", "CALL_FAILED"],
  ])("%s -> %s", (i, o) => expect(classifyOutcome(i)).toBe(o));
  it.each([[""], ["pending"], ["abc"], ["call transferred"]])("cannot tell: %s", (i) => expect(classifyOutcome(i)).toBeNull());
  it("a negative is never read as a confirmation", () => { expect(classifyOutcome("not interested")).not.toBe("WALKIN_CONFIRMED_YES"); expect(classifyOutcome("will not come")).toBe("WALKIN_DECLINED_NEEDS_FOLLOWUP"); expect(classifyOutcome("not confirmed - declined")).toBe("WALKIN_DECLINED_NEEDS_FOLLOWUP"); });
});

describe("mapResultHeaders", () => {
  it("finds vendor-style headers", () => {
    const r = mapResultHeaders(["Mobile Number", "Call Status", "Duration (sec)", "Call ID", "Remarks"]);
    expect(r.missing).toEqual([]);
    expect(r.map.phone).toBe("Mobile Number");
  });
  it("reports missing phone/result", () => expect(mapResultHeaders(["x"]).missing.length).toBe(2));
});

describe("parseResultRows", () => {
  const base = { phone: "9999746258", result: "Confirmed", call_id: "c1", duration: 64 };
  it("confirmed -> BRD fields", () => {
    const r = parseResultRows([base]).rows[0];
    expect(r.ok).toBe(true);
    expect(r.voice).toMatchObject({ answered: true, identityConfirmed: "yes", originalSlotAnswer: "yes", durationS: 64 });
  });
  it("rescheduled carries the new slot", () => {
    const r = parseResultRows([{ phone: "9999746258", result: "Rescheduled", new_date: "10/10/2026", new_time: "2:30 PM" }]).rows[0];
    expect(r.newInterviewAt).toBe("2026-10-10 14:30:00");
    expect(r.voice).toMatchObject({ originalSlotAnswer: "no", offeredSlotAnswer: "yes" });
  });
  it("warns when a reschedule has no date", () => expect(parseResultRows([{ phone: "9999746258", result: "Rescheduled" }]).rows[0].warnings.length).toBe(1));
  it("no answer / failed are not 'answered'", () => {
    expect(parseResultRows([{ phone: "9999746258", result: "No answer" }]).rows[0].voice?.answered).toBe(false);
    expect(parseResultRows([{ phone: "9999746258", result: "Switched off" }]).rows[0].voice?.failedReason).toBe("Switched off");
  });
  it("an unrecognised result is an error, never guessed", () => {
    const r = parseResultRows([{ phone: "9999746258", result: "pending review" }]).rows[0];
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/could not understand/);
  });
  it("bad phone and duplicate call rows are rejected", () => {
    const rows = parseResultRows([base, { ...base }, { ...base, phone: "12" }]).rows;
    expect(rows.map((x) => x.ok)).toEqual([true, false, false]);
  });
  it("missing columns reported once", () => expect(parseResultRows([{ foo: 1 }]).missingColumns.length).toBe(2));
});
