/** Campaign map (C4) and the relink dialog: markup in node (renderToStaticMarkup). Clicks, focus and the dialogs' open state need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));

import { CampaignMatrixView } from "../command/CampaignMatrix";
import { RelinkForm } from "../command/RelinkDialog";
import { previewLines, reasonError, relinkBody } from "../command/relinkModel";
import type { CampaignMatrixData, MatrixCellData, MatrixRowData } from "../command/campaignMatrixModel";

const cell = (o: Partial<MatrixCellData> = {}): MatrixCellData => ({ kind: "meta_live", state: "running", reason: null, reasonText: "3 contacted in 48 h", activity48h: 3, streamId: "s1", streamStatus: "open", mapIt: null, relink: false, ...o });
const row = (o: Partial<MatrixRowData> = {}, cells: Partial<Record<"meta_live" | "meta_old" | "he", Partial<MatrixCellData>>> = {}): MatrixRowData => ({
  key: "c1|r1", campaign: { id: "c1", name: "K7BK Onfido night", status: "active", hasForm: true },
  requisition: { id: "r1", code: "REQ-2609-K7BK", branch: "NOIDA-2", closedReason: "requisition is closed", endDate: "2026-10-01", endDatePassed: true, seatsLeft: 0, bmiLinkPresent: true,
    completeness: { score: 20, label: "incomplete", missing: ["age"], enrolmentReady: false } },
  cells: {
    meta_live: cell({ state: "idle", reason: "requisition_closed", reasonText: "Requisition REQ-2609-K7BK is closed", relink: true, streamId: null, streamStatus: null, activity48h: 0, ...cells.meta_live }),
    meta_old: cell({ kind: "meta_old", state: "not_mapped", mapIt: { requisitionId: "r1", sourceType: "meta_old", originId: null }, streamId: null, streamStatus: null, activity48h: 0, ...cells.meta_old }),
    he: cell({ kind: "he", ...cells.he }),
  },
  ...o,
});
const data = (rows: MatrixRowData[] = [row()]): CampaignMatrixData => ({ rows, generatedAt: "2026-10-09T06:00:00Z", partial: [], enforcedEndDate: false });
const noop = () => undefined;
const view = (p: Partial<React.ComponentProps<typeof CampaignMatrixView>> = {}) => renderToStaticMarkup(
  <CampaignMatrixView data={data()} loading={false} error={null} canWrite filters={{ branch: "", state: "all", onlyProblems: false }} branches={["NOIDA-2"]} expanded={null}
    analytics={null} onFilters={noop} onExpand={noop} onRetry={noop} onAction={noop} {...p} />);

describe("CampaignMatrixView", () => {
  it("every cell is icon + word + reason; the K7BK cell offers the relink, a not-mapped cell Map it", () => {
    const html = view();
    expect(html).toContain("Idle");
    expect(html).toContain("Requisition REQ-2609-K7BK is closed");
    expect(html).toContain("Relink to an open requisition");
    expect(html).toContain("Map it");
    expect(html).toContain("Not mapped");
    expect(html).toContain("Ended 1 Oct 2026");
    expect(html).toMatch(/aria-label="Map it: Old Meta data for REQ-2609-K7BK"/);
  });
  it("view-only roles see no action buttons", () => {
    const html = view({ canWrite: false });
    expect(html).not.toContain("Map it</");
    expect(html).not.toContain("Relink to an open requisition</");
  });
  it("row expand is a real button with aria-expanded / aria-controls, and the drill-down lists the stages", () => {
    const collapsed = view();
    expect(collapsed).toMatch(/aria-expanded="false"/);
    const open = view({ expanded: "c1|r1", analytics: { byRequisition: [{ requisitionId: "r1", sourceType: "he", stages: { leads: 5, contacted: 4, invited: 2 } }], campaigns: [] } });
    expect(open).toMatch(/aria-expanded="true"/);
    expect(open).toContain("Contacted");
    expect(open).toContain("No people for this campaign and requisition in the date range");
  });
  it("loading, error with Retry, empty and partial states", () => {
    expect(view({ data: null, loading: true })).toContain('aria-busy="true"');
    expect(view({ data: null, error: "boom" })).toContain("Retry");
    expect(view({ data: data([]) })).toContain("No campaign or open requisition in your scope");
    expect(view({ data: { ...data(), partial: ["shortlist"] } })).toContain("Some facts could not be read");
  });
  it("the table scrolls inside its own container and paints dark colours on cells", () => {
    const html = view();
    expect(html).toContain("relative overflow-x-auto");
    expect(html).toContain("dark:text-slate-100");
    expect(html).not.toMatch(/\d{10}/);
  });
});

describe("relink model and form", () => {
  const preview = { campaignId: "c1", fromRequisitionId: "r1", fromCode: "REQ-2609-K7BK", fromClosedReason: "requisition is closed", toRequisitionId: "r2", toCode: "NOIDA-ONF-17",
    toBranch: "NOIDA-2", move: { total: 40, qualified: 30, disqualified: 8, pending: 2 }, stay: 12, warnings: ["The lead form carries the hidden code REQ-2609-K7BK"], previewHash: "h".repeat(64) };
  it("preview lines say who moves and who stays", () => {
    expect(previewLines(preview)).toEqual([
      "40 people not yet contacted move to NOIDA-ONF-17 (30 qualified, 8 disqualified, 2 pending).",
      "12 people already contacted stay on REQ-2609-K7BK.",
      "NOIDA-ONF-17 becomes the campaign's main requisition; REQ-2609-K7BK stays linked.",
    ]);
  });
  it("a reason is required; the body carries the preview hash and confirm", () => {
    expect(reasonError("")).toBe("Give a reason (3 to 300 characters)");
    expect(reasonError("ok fine")).toBeNull();
    expect(relinkBody(preview, " K7BK closed ")).toEqual({ toRequisitionId: "r2", previewHash: "h".repeat(64), reason: "K7BK closed", confirm: true });
  });
  it("the form shows the preview, the warnings, and only enables Confirm after a preview", () => {
    const before = renderToStaticMarkup(<RelinkForm campaignName="K7BK" fromCode="REQ-2609-K7BK" options={[{ id: "r2", label: "NOIDA-ONF-17" }]} to="r2" preview={null} reason="" busy={false} error={null}
      onTo={noop} onPreview={noop} onReason={noop} onConfirm={noop} onCancel={noop} idPrefix="t" />);
    expect(before).toMatch(/<button[^>]*disabled=""[^>]*>Confirm relink/);
    const after = renderToStaticMarkup(<RelinkForm campaignName="K7BK" fromCode="REQ-2609-K7BK" options={[{ id: "r2", label: "NOIDA-ONF-17" }]} to="r2" preview={preview} reason="K7BK closed" busy={false} error={null}
      onTo={noop} onPreview={noop} onReason={noop} onConfirm={noop} onCancel={noop} idPrefix="t" />);
    expect(after).toContain("40 people not yet contacted move to NOIDA-ONF-17");
    expect(after).toContain("hidden code REQ-2609-K7BK");
    expect(after).not.toMatch(/<button[^>]*disabled=""[^>]*>Confirm relink/);
  });
});
