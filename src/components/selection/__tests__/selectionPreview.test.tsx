import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectionPreviewView, type PreviewViewProps } from "../SelectionPreview";
import SampleTable from "../SampleTable";
import type { PreviewResult } from "../selectionTypes";

const all = { read: true, edit: true, export: true, approve: true, override: true };
const preview: PreviewResult = { requisitionId: "r1", versionId: "v", draft: false, source: "he", subSource: "all", start: 120,
  steps: [{ key: "age", label: "Age: 18 to 35", kind: "must", remaining: 90, failedHere: 30, reviewHere: 12, onlyThisRuleFails: 9, ifRemovedGain: 9 }],
  outcome: { shortlist: 60, review: 30, rejected: 30, systemExcluded: 4 }, scoreBuckets: [{ from: 0, to: 20, n: 5 }],
  sample: [{ maskedMobile: "98XXXXXX21", firstName: "Asha", subSource: "naukri_import", verdict: "review", score: 40, override: null,
    cells: [{ key: "age", outcome: "unknown", text: "age not known" }, { key: "night_shift", outcome: "pass", text: "willing" }] }],
  capPreview: { seatsLeft: 3, dailyCap: null }, generatedAt: "t", partial: ["capped_at_100000"] };
const noop = () => undefined;
const view = (o: Partial<PreviewViewProps> = {}) => renderToStaticMarkup(<SelectionPreviewView source="he" sub="all" onSource={noop} onSub={noop} data={preview} loading={false} error={null}
  onRetry={noop} permissions={all} onCsv={noop} csvBusy={false} {...o} />);

describe("selection preview", () => {
  it("source tabs incl. Naukri / WorkIndia uploads under Hiring Engine", () => {
    const html = view();
    expect(html).toContain('role="tab" aria-selected="true"');
    expect(html).toContain("Live Meta"); expect(html).toContain("Old Meta data");
    expect(html).toContain("Naukri upload"); expect(html).toContain("WorkIndia upload");
  });
  it("outcome tiles, partial banner and the funnel text alternative", () => {
    const html = view();
    expect(html).toContain("Only the first 1,00,000 people were evaluated");
    expect(html).toMatch(/Shortlist<\/dt><dd[^>]*>60</);
    expect(html).toContain("Rule funnel: 120 people start, 90 remain after every rule");
    expect(html).toContain("Show table");
  });
  it("sample: masked mobile, icon + word per rule, reason as accessible name, own scroll box", () => {
    const html = renderToStaticMarkup(<SampleTable preview={preview} />);
    expect(html).toContain("98XXXXXX21");
    expect(html).not.toMatch(/\d{10}/);
    expect(html).toContain('aria-label="Age: unknown, age not known"');
    expect(html).toContain(">Unknown<"); expect(html).toContain(">Yes<");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("Naukri");
  });
  it("CSV only with the export permission; ceo sees none", () => {
    expect(view()).toContain("Download CSV");
    expect(view({ permissions: { ...all, export: false, edit: false, approve: false, override: false } })).not.toContain("Download CSV");
  });
  it("loading skeleton, error with Retry, honest empty state", () => {
    expect(view({ data: null, loading: true })).toContain('aria-label="Loading the preview"');
    const err = view({ data: null, error: "Server error" });
    expect(err).toContain("Could not load the preview: Server error"); expect(err).toContain("Retry");
    expect(view({ data: { ...preview, start: 0, steps: [], sample: [] } })).toContain("Nobody in this source yet");
  });
});
