import { describe, it, expect } from "vitest";
import { parseDate, BELLA_REPEAT_ALIGNMENT_HEADERS } from "../bella-repeat-alignment-bulk.service.js";

describe("parseDate", () => {
  it("reads the real DOJ Excel serial from the sample (44829 = 2022-09-25)", () => {
    expect(parseDate(44829)).toBe("2022-09-25");
  });
  it("returns null for blank", () => {
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(BELLA_REPEAT_ALIGNMENT_HEADERS).toContain("MAS_ID");
    expect(BELLA_REPEAT_ALIGNMENT_HEADERS).toContain("TL");
  });
});
