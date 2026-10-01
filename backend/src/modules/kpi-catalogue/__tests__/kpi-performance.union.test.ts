import { describe, it, expect } from "vitest";
import { unionCodes } from "../kpi-performance.service.js";

describe("unionCodes", () => {
  it("merges JSON strings and arrays without duplicates, keeping order", () => {
    expect(unionCodes(['["GNC"]', ["GNC", "GUARDIAN_HC"], '["GUARDIAN_HC","X"]'])).toEqual(["GNC", "GUARDIAN_HC", "X"]);
  });
  it("tolerates null, bad JSON and blanks", () => {
    expect(unionCodes([null, "not json", [], [""], '["A"]'])).toEqual(["A"]);
  });
});
