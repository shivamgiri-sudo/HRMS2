import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn() } }));

import { intakeDateOfBirth } from "../atsFullParity.service.js";

describe("intakeDateOfBirth", () => {
  it("accepts ISO and day-first formats and returns YYYY-MM-DD", () => {
    expect(intakeDateOfBirth({ dateOfBirth: "1998-04-09" })).toBe("1998-04-09");
    expect(intakeDateOfBirth({ DOB: "09/04/1998" })).toBe("1998-04-09");
    expect(intakeDateOfBirth({ "Date of Birth": "9-4-1998" })).toBe("1998-04-09");
  });

  it("returns null for blank, malformed, impossible or implausible dates", () => {
    expect(intakeDateOfBirth({})).toBeNull();
    expect(intakeDateOfBirth({ dob: "not a date" })).toBeNull();
    expect(intakeDateOfBirth({ dob: "31/02/1998" })).toBeNull(); // rolls over to March, so rejected
    expect(intakeDateOfBirth({ dob: "1900-01-01" })).toBeNull();
    expect(intakeDateOfBirth({ dob: `${new Date().getUTCFullYear()}-01-01` })).toBeNull(); // not a working-age candidate
  });
});
