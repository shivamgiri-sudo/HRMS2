import { describe, expect, it } from "vitest";
import { normalizeClientName } from "../src/modules/branch-health-report/query.js";

describe("normalizeClientName", () => {
  it("drops company suffixes and punctuation so db_bill and HRMS spellings meet", () => {
    expect(normalizeClientName("FINNABLE TECHNOLOGIES PRIVATE LIMITED")).toBe(
      "finnabletechnologies",
    );
    expect(normalizeClientName("Housing.com")).toBe("housingcom");
    expect(normalizeClientName("Onfido Limited ")).toBe("onfido");
  });
});
