import { describe, expect, it } from "vitest";
import { mapIntakeRows } from "../he-intake.js";

describe("intake mapping", () => {
  it("maps aliased headers, rejects bad and duplicate numbers", () => {
    const r = mapIntakeRows([
      { "Candidate Name": "A", "Mobile No": "+91 98765-43210", "Email ID": "a@x.in", Qualification: "Graduate", "Total Experience": "2 yrs", Consent: "Yes" },
      { "Candidate Name": "B", "Mobile No": "12345" },
      { "Candidate Name": "A again", "Mobile No": "9876543210" },
    ]);
    expect(r.rows[0]).toMatchObject({ ok: true, mobile10: "9876543210", email: "a@x.in", experienceYears: 2, consent: true });
    expect(r.rows[1]).toMatchObject({ ok: false, reason: "invalid_mobile" });
    expect(r.rows[2]).toMatchObject({ ok: false, reason: "duplicate_in_file" });
  });
  it("needs a mobile column", () => {
    expect(mapIntakeRows([{ name: "x" }]).missingColumns).toEqual(["mobile"]);
  });
});
