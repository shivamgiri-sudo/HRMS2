import { describe, it, expect, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import { extractDobFromText } from "../ageVerification.service.js";

describe("extractDobFromText ignores document dates", () => {
  it("does not read an Aadhaar issue date as a birth date", () => {
    expect(extractDobFromText("Bi Aadhaar no. issued: 19/11/2011 = q")).toBeNull();
  });
  it("still reads a labelled date of birth", () => {
    expect(extractDobFromText("Government of India DOB: 08/07/2003 FEMALE")).toBe("2003-07-08");
  });
});
