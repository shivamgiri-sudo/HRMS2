import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CriteriaEditorBody, { type EditorBodyProps } from "../CriteriaEditorBody";
import { initDraft, setColumn } from "../criteriaEditorModel";
import type { CriteriaResponse, PreviewResult } from "../selectionTypes";

const resp = (o: Partial<CriteriaResponse["row"]> = {}, perms = { read: true, edit: true, export: true, approve: true, override: true }): CriteriaResponse => ({
  row: { id: "r1", code: "REQ-2609-K7BK", branchName: "NOIDA-2", branchCity: "Noida", processName: "Onfido", approvalStatus: "approved", educationRequirement: null, skillsRequired: "Excel",
    experienceMinYears: null, experienceMaxYears: null, ageMin: 18, ageMax: 35, targetLocations: null, radiusKm: null, shiftRequirement: null, nightShiftRequired: 0, rotationalShift: 1,
    salaryMin: 15000, salaryMax: 18000, screeningConfig: { custom_field_rules: [{ field: "are_you_a_graduate", op: "is_yes", value: "", label: "Graduate (must)" }] },
    selectionRules: { schema: 1, rules: { age: { mode: "must", missing: "review" } } }, ...o },
  compiled: { rules: [{ key: "rotational_shift", label: "OK with rotational shifts", requiredText: "OK with rotational shifts", mode: "must", weight: 0, missing: "review", origin: "column", defaulted: true }],
    undecided: [], completeness: { score: 39, label: "incomplete", missing: ["education_min"], enrolmentReady: false }, legacy: false, hash: "h" },
  completeness: { score: 39, label: "incomplete", missing: ["education_min"], enrolmentReady: false }, issues: [], versions: [], permissions: perms,
});
const preview: PreviewResult = { requisitionId: "r1", versionId: "v", draft: false, source: "he", subSource: "all", start: 30,
  steps: [{ key: "rotational_shift", label: "R", kind: "must", remaining: 30, failedHere: 0, reviewHere: 21, onlyThisRuleFails: 0, ifRemovedGain: 0 }],
  outcome: { shortlist: 2, review: 21, rejected: 0, systemExcluded: 7 }, scoreBuckets: [], sample: [], capPreview: { seatsLeft: 3, dailyCap: null }, generatedAt: "t", partial: [] };
const noop = () => undefined;
const render = (r: CriteriaResponse, o: Partial<EditorBodyProps> = {}) => {
  const d = initDraft(r);
  return renderToStaticMarkup(<CriteriaEditorBody resp={r} draft={d} initial={d} onDraft={noop} issues={[]} checking={false} reason="" onReason={noop} ack={false} onAck={noop}
    saved={preview} whatIf={null} busy={false} message={null} onSave={noop} onPreviewDraft={noop} {...o} />);
};

describe("criteria editor body", () => {
  it("K7BK-like requisition (snapshot)", () => {
    expect(render(resp())).toMatchSnapshot();
  });
  it("shows the undecided-rules banner with live counts and one-click 'no requirement'", () => {
    const html = render(resp());
    expect(html).toContain("Undecided rules currently act as MUST: most people will go to review");
    expect(html).toContain("OK with rotational shifts: 21 to review, 0 rejected now");
    expect(html).toContain('aria-label="Decide: no requirement for OK with rotational shifts"');
  });
  it("MUST / PREFER / No requirement is a radio group per rule; the system rules are listed and locked", () => {
    const html = render(resp());
    expect(html).toContain('role="radiogroup" aria-label="Age: how it counts"');
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>MUST</);
    expect(html).toContain("System rules (cannot be changed):");
  });
  it("salary is locked on an approved requisition; the reason is required", () => {
    const html = render(resp());
    expect(html).toContain("Change needs re-approval");
    expect(html).toContain("Reason (required: this requisition is approved)");
    const d = initDraft(resp());
    const html2 = renderToStaticMarkup(<CriteriaEditorBody resp={resp()} draft={setColumn(d, "ageMax", "40")} initial={d} onDraft={noop} issues={[]} checking={false} reason="" onReason={noop} ack={false} onAck={noop}
      saved={null} whatIf={null} busy={false} message={null} onSave={noop} onPreviewDraft={noop} />);
    expect(html2).toMatch(/<button[^>]*disabled=""[^>]*>Save criteria</);
    expect(html2).toContain("A reason is required to change an approved requisition");
  });
  it("view-only roles (ceo) see no write controls at all", () => {
    const html = render(resp({}, { read: true, edit: false, export: false, approve: false, override: false }));
    expect(html).toContain("You can read these criteria; only HR can change them.");
    expect(html).not.toContain("Save criteria");
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain("Decide: no requirement");
    expect(html).not.toContain("Templates and copy");
  });
  it("errors and warnings are written out, never colour only; warnings need ticking", () => {
    const html = render(resp(), { issues: [{ level: "error", keys: ["age"], text: "Age band 40 to 30" }, { level: "warning", keys: [], text: "Typing above 60" }] });
    expect(html).toContain("Error: Age band 40 to 30");
    expect(html).toContain("Warning: Typing above 60");
    expect(html).toContain("I have read the warnings");
  });
  it("what-if delta table", () => {
    const html = render(resp(), { whatIf: { ...preview, draft: true, outcome: { shortlist: 20, review: 3, rejected: 0, systemExcluded: 7 } } });
    expect(html).toContain("Draft against saved criteria");
    expect(html).toMatch(/Shortlist<\/th><td[^>]*>2<\/td><td[^>]*>20<\/td><td[^>]*>\+18</);
  });
});
