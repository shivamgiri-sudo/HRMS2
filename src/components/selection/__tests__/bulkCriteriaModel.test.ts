import { describe, expect, it } from "vitest";
import { bulkPatch, canConfirm, diffView, emptyChoice } from "../bulkCriteriaModel";
import type { BulkRow } from "../selectionTypes";

const rows: BulkRow[] = [
  { requisitionId: "a", versionId: null, issues: [], diff: [{ field: "education_requirement", from: null, to: "12th" }, { field: "meta_target_age_min", from: 21, to: 18, skipped: "filled" }] },
  { requisitionId: "b", versionId: null, issues: [{ level: "error", keys: ["age"], text: "Age band 18 to 16" }], diff: [{ field: "meta_target_age_max", from: null, to: 16 }] },
  { requisitionId: "c", versionId: null, issues: [{ level: "warning", keys: [], text: "w" }], diff: [] },
];
const codes = { a: "REQ-A", b: "REQ-B", c: "REQ-C" };

describe("bulkPatch", () => {
  it("only the values HR filled in", () => {
    expect(bulkPatch(emptyChoice())).toEqual({});
    expect(bulkPatch({ ...emptyChoice(), educationRequirement: "12th", ageMin: "18", ageMax: "", nightShift: "yes", cities: "Noida, Ghaziabad", enrolment: "hr_approves" }))
      .toEqual({ educationRequirement: "12th", ageMin: 18, nightShiftRequired: 1, targetLocations: ["Noida", "Ghaziabad"], selectionRules: { schema: 1, rules: {}, enrolment: { mode: "hr_approves", standingApprovalDays: 7 } } });
  });
});

describe("diffView", () => {
  it("groups per requisition: changes, kept (already filled), errors and warnings; counts", () => {
    const v = diffView(rows, codes);
    expect(v.items[0]).toEqual({ id: "a", code: "REQ-A", changes: [{ field: "Minimum qualification", from: "not set", to: "12th" }], kept: [{ field: "Age from", from: "21", to: "18" }], errors: [], warnings: [], nothing: false });
    expect(v.items[2].nothing).toBe(true);
    expect(v.counts).toEqual({ changing: 2, kept: 1, withErrors: 1 });
  });
});

describe("canConfirm", () => {
  it("blocked while an included requisition has errors; excluding it allows the rest", () => {
    expect(canConfirm(rows, new Set(), { reason: "x", anyApproved: true, codes })).toMatchObject({ ok: false, why: expect.stringMatching(/REQ-B/) });
    expect(canConfirm(rows, new Set(["b"]), { reason: "x", anyApproved: true })).toEqual({ ok: true, why: null });
  });
  it("needs a reason when an approved requisition is included; nothing to change is not confirmable", () => {
    expect(canConfirm(rows, new Set(["b"]), { reason: " ", anyApproved: true }).ok).toBe(false);
    expect(canConfirm(rows, new Set(["a", "b"]), { reason: "x", anyApproved: false })).toMatchObject({ ok: false, why: "Nothing would change" });
  });
});
