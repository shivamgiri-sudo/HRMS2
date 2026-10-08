import { describe, expect, it } from "vitest";
import { BULK_CALL_MAX_ROWS, dateLabel, mapHeaders, parseDate, parseTime, sampleCsv, timeLabel, validateBulkCalls } from "../he-bulk-call.js";

const NOW = "2026-10-05 12:00:00";
const good = { phone: "9876543210", name: "Rohit", role: "Telesales", interview_date: "16/10/2026", interview_time: "10:30 AM", branch_address: "Trapezoid IT Park, Sector 62, Noida", reference_id: "R1" };

describe("parseDate", () => {
  it.each([
    ["2026-10-16", "2026-10-16"], ["16/10/2026", "2026-10-16"], ["16-10-2026", "2026-10-16"], ["16.10.26", "2026-10-16"],
    ["Wed, 16 Oct 2026", "2026-10-16"], ["16 Oct 2026", "2026-10-16"], ["16-Oct-2026", "2026-10-16"], ["Oct 16, 2026", "2026-10-16"],
    [46311, "2026-10-16"], ["1/2/2027", "2027-02-01"],
  ])("%s -> %s", (i, o) => expect(parseDate(i)).toBe(o));
  it.each([["31/02/2026"], ["2026-13-01"], ["tomorrow"], [""], [12], ["16/10"]])("rejects %s", (i) => expect(parseDate(i)).toBeNull());
  it("DD/MM, not US MM/DD", () => expect(parseDate("05/10/2026")).toBe("2026-10-05"));
});

describe("parseTime", () => {
  it.each([["10:30 AM", "10:30:00"], ["10.30am", "10:30:00"], ["2:15 PM", "14:15:00"], ["12:00 AM", "00:00:00"], ["12:30 PM", "12:30:00"], ["14:00", "14:00:00"], ["1030", "10:30:00"], ["9 am", "09:00:00"], [0.4375, "10:30:00"], [0.5, "12:00:00"]])("%s -> %s", (i, o) => expect(parseTime(i)).toBe(o));
  it.each([["25:00"], ["10:75"], ["13:00 PM"], ["abc"], [""], [46311.0]])("rejects %s", (i) => expect(parseTime(i)).toBeNull());
});

describe("labels", () => {
  it("spoken labels", () => { expect(dateLabel("2026-10-16")).toBe("Fri, 16 Oct 2026"); expect(timeLabel("14:05:00")).toBe("2:05 PM"); expect(timeLabel("00:30:00")).toBe("12:30 AM"); });
});

describe("mapHeaders", () => {
  it("accepts aliases, case and spacing", () => {
    const r = mapHeaders(["Phone Number", "Candidate Name", "Designation", "Interview Date", "Interview Time", "Branch Address", "Ref"]);
    expect(r.missing).toEqual([]);
    expect(r.map.phone).toBe("Phone Number");
    expect(r.map.reference_id).toBe("Ref");
  });
  it("reports missing required columns (reference_id optional)", () => expect(mapHeaders(["phone", "name"]).missing).toEqual(["role", "interview_date", "interview_time", "branch_address"]));
});

describe("validateBulkCalls", () => {
  it("accepts a good row and builds the call record", () => {
    const { results } = validateBulkCalls([good], NOW);
    expect(results[0].ok).toBe(true);
    expect(results[0].row).toMatchObject({ mobile10: "9876543210", interviewAt: "2026-10-16 10:30:00", referenceId: "R1", rowNo: 2 });
  });
  it("collects every error on a bad row", () => {
    const { results } = validateBulkCalls([{ ...good, phone: "123", name: "", role: "", interview_date: "31/02/2026", interview_time: "99", branch_address: "x" }], NOW);
    expect(results[0].errors.length).toBe(6);
    expect(results[0].ok).toBe(false);
  });
  it("rejects a past interview, warns when imminent", () => {
    expect(validateBulkCalls([{ ...good, interview_date: "2026-10-05", interview_time: "11:00" }], NOW).results[0].errors).toContain("interview is in the past");
    expect(validateBulkCalls([{ ...good, interview_date: "2026-10-05", interview_time: "12:10" }], NOW).results[0].warnings.length).toBe(1);
  });
  it("only the first duplicate phone is accepted; +91 formatting is normalised", () => {
    const { results } = validateBulkCalls([good, { ...good, phone: "+91 98765-43210" }], NOW);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(results[1].errors[0]).toMatch(/duplicate of row 2/);
  });
  it("keeps the sheet's own values on a rejected row so it is recognisable", () => {
    const r = validateBulkCalls([{ ...good, phone: "12345", interview_date: "31/02/2026" }], NOW).results[0];
    expect(r.ok).toBe(false);
    expect(r.display).toMatchObject({ phone: "12345", name: "Rohit", role: "Telesales" });
    expect(r.display.when).toContain("31/02/2026");
  });
  it("generates a reference id when blank", () => expect(validateBulkCalls([{ ...good, reference_id: "" }], NOW).results[0].row?.referenceId).toBe("BC-3210" + "1016"));
  it("reports missing columns instead of per-row noise", () => expect(validateBulkCalls([{ phone: "9876543210" }], NOW).missingColumns.length).toBe(5));
  it("caps the batch size", () => expect(validateBulkCalls(Array.from({ length: BULK_CALL_MAX_ROWS + 1 }, () => good), NOW).tooMany).toBe(true));
  it("accepts Excel serial date/time cells", () => {
    const { results } = validateBulkCalls([{ ...good, interview_date: 46311, interview_time: 0.4375 }], NOW);
    expect(results[0].row?.interviewAt).toBe("2026-10-16 10:30:00");
  });
  it("the downloadable sample passes its own validation", () => {
    const lines = sampleCsv().split("\n");
    const hdr = lines[0].split(",");
    expect(hdr).toEqual(["phone", "name", "role", "interview_date", "interview_time", "branch_address", "reference_id"]);
  });
});
