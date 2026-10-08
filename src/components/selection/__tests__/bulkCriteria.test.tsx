import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BulkCriteriaBody, type BulkBodyProps } from "../BulkCriteriaDialog";
import { emptyChoice } from "../bulkCriteriaModel";
import type { RequisitionItem } from "../selectionTypes";

const item = (id: string, approvalStatus: string): RequisitionItem => ({ id, code: `REQ-${id}`, branch: "NOIDA-2", process: "Onfido", designation: "CSE", approvalStatus,
  completeness: { score: 20, label: "incomplete", missing: [], enrolmentReady: false }, legacy: true, undecided: [], defaultedMust: [], version: null });
const noop = () => undefined;
const props = (o: Partial<BulkBodyProps> = {}): BulkBodyProps => ({ items: [item("a", "approved"), item("b", "closed")], picked: new Set(["a"]), onPick: noop, choice: { ...emptyChoice(), educationRequirement: "12th" },
  onChoice: noop, diff: null, excluded: new Set(), onExclude: noop, reason: "", onReason: noop, busy: false, result: null, error: null, onShow: noop, onConfirm: noop, ...o });

describe("bulk criteria body", () => {
  it("closed requisitions cannot be ticked; nothing to confirm before the diff", () => {
    const html = renderToStaticMarkup(<BulkCriteriaBody {...props()} />);
    expect(html).toMatch(/disabled=""[^>]*\/><span[^>]*>REQ-b[^<]*\(read-only\)/);
    expect(html).not.toContain("Save on every requisition");
  });
  it("the diff table: changes, kept values, errors written out, leave-out checkboxes; confirm blocked by errors", () => {
    const html = renderToStaticMarkup(<BulkCriteriaBody {...props({ diff: [{ requisitionId: "a", versionId: null, diff: [{ field: "education_requirement", from: null, to: "12th" }, { field: "meta_target_age_min", from: 21, to: 18, skipped: "filled" }],
      issues: [{ level: "error", keys: [], text: "Age band 18 to 16" }] }] })} />);
    expect(html).toContain("Minimum qualification: not set to 12th");
    expect(html).toContain("Age from: stays 21");
    expect(html).toContain("Error: Age band 18 to 16");
    expect(html).toContain('aria-label="Leave out REQ-a"');
    expect(html).toMatch(/disabled=""[^>]*>4\. Save on every requisition/);
    expect(html).toContain("Fix or leave out REQ-a");
    expect(html).toContain("Reason (required: approved requisitions are included)");
  });
});
