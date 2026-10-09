import { describe, expect, it } from "vitest";
import { patchShapeError } from "../criteria-patch-shape.js";

/** M7: a criteria patch with the wrong types or sizes is a 400 with a message, never a 500 deep in validation. */
describe("criteria patch shape", () => {
  it("accepts a normal patch, nulls and numeric strings", () => {
    expect(patchShapeError({ ageMin: 18, ageMax: "35", educationRequirement: "Graduate", targetLocations: ["Noida"], nightShiftRequired: 1,
      screeningConfig: { gender: "female", certifications: ["DRA"], custom_field_rules: [{ field: "q1", accepted_values: ["yes"] }], min_typing_speed_wpm: 25 } })).toBeNull();
    expect(patchShapeError({ ageMin: null, targetLocations: null, screeningConfig: { custom_field_rules: null } })).toBeNull();
  });
  it.each([
    [{ ageMin: "eighteen" }, /ageMin/],
    [{ ageMax: 1e9 }, /ageMax/],
    [{ experienceMinYears: -1 }, /experienceMinYears/],
    [{ radiusKm: [5] }, /radiusKm/],
    [{ educationRequirement: { x: 1 } }, /educationRequirement/],
    [{ skillsRequired: "x".repeat(1001) }, /skillsRequired/],
    [{ nightShiftRequired: 7 }, /nightShiftRequired/],
    [{ targetLocations: "Noida" }, /targetLocations/],
    [{ targetLocations: Array.from({ length: 51 }, () => "x") }, /targetLocations/],
    [{ targetLocations: [1, 2] }, /targetLocations/],
    [{ screeningConfig: "x" }, /screeningConfig/],
    [{ screeningConfig: [1] }, /screeningConfig/],
    [{ screeningConfig: { custom_field_rules: { field: "q1" } } }, /custom_field_rules/],
    [{ screeningConfig: { custom_field_rules: ["x"] } }, /custom_field_rules/],
    [{ screeningConfig: { certifications: "DRA" } }, /certifications/],
    [{ screeningConfig: { big: "x".repeat(20_000) } }, /screeningConfig/],
    [{ selectionRules: "rules" }, /selectionRules/],
  ])("%j is refused", (patch, re) => {
    expect(patchShapeError(patch as never)).toMatch(re);
  });
});
