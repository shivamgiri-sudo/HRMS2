/** Campaign requisitions editor (WS3 A4): pure model + static markup in node. Clicks, the confirm step and the requests need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { CampaignRequisitionsView } from "../meta/CampaignRequisitionsEditor";
import { addOptions, heldPlaceOptions, linkRowView, linksPath, placePath, type CampaignLink } from "../meta/campaignRequisitionsModel";

const link = (o: Partial<CampaignLink> = {}): CampaignLink => ({ campaignId: "c1", requisitionId: "r1", code: "NOIDA-ONF-17", branch: "NOIDA-2", isPrimary: true, sortOrder: 0,
  openReason: null, endDate: "2026-10-20", endDatePassed: false, endedReason: null, seatsLeft: 25, bmiLinkPresent: false,
  criteria: { score: 15, label: "incomplete", missing: ["age", "education_min", "night_shift"], enrolmentReady: false }, ...o });

describe("model", () => {
  it("a row: main star in words, seats, end date chip, criteria label, open / closed text", () => {
    expect(linkRowView(link())).toEqual({ code: "NOIDA-ONF-17", branch: "NOIDA-2", main: "Main requisition", seats: "25 seats left", end: { text: "Ends 20 Oct 2026", ended: false },
      criteria: "Criteria incomplete (missing: age, education min, night shift)", enrolment: "Enrolment blocked: criteria incomplete", state: "Open" });
    const closed = linkRowView(link({ isPrimary: false, openReason: "requisition is closed", endDate: "2026-10-01", endDatePassed: true, criteria: null }));
    expect(closed).toMatchObject({ main: "", state: "Closed: requisition is closed", end: { text: "Ended 1 Oct 2026", ended: true }, criteria: "Criteria not read" });
  });
  it("add options leave out what is already linked", () => {
    expect(addOptions([{ id: "r1", label: "A", branch: "NOIDA-2" }, { id: "r2", label: "B", branch: "NOIDA-2" }], [link()])).toEqual([{ id: "r2", label: "B · NOIDA-2" }]);
  });
  it("a held lead can be placed on an open link only", () => {
    expect(heldPlaceOptions([link(), link({ requisitionId: "r9", code: "OLD", openReason: "requisition is closed", isPrimary: false })])).toEqual([{ id: "r1", label: "NOIDA-ONF-17" }]);
  });
  it("paths", () => {
    expect(linksPath("c1")).toBe("/api/meta/campaigns/c1/requisitions");
    expect(placePath("l1")).toBe("/api/meta/leads/l1/requisition");
  });
});

describe("CampaignRequisitionsView", () => {
  const base = { links: [link(), link({ requisitionId: "r2", code: "NOIDA-ONF-18", isPrimary: false })], loading: false, error: null, canWrite: true, options: [{ id: "r3", label: "AHM-SBI-01 · AHMEDABAD" }],
    held: { counts: { hold: 1, best_fit: 4 }, held: [{ id: "l1", name: "Rig", maskedMobile: "99xxxxxx22", requisitionId: "r1", at: "2026-10-09T06:00:00Z" }] },
    note: null, confirmRemove: null, busy: false, onAdd: () => undefined, onRemove: () => undefined, onConfirmRemove: () => undefined, onCancelRemove: () => undefined,
    onPrimary: () => undefined, onPlace: () => undefined, onRetry: () => undefined };
  it("lists the links with write controls for writers, and the held people masked", () => {
    const html = renderToStaticMarkup(<CampaignRequisitionsView {...base} />);
    expect(html).toContain("Requisitions (2)");
    expect(html).toContain("Main requisition");
    expect(html).toContain("Make main");
    expect(html).toMatch(/aria-label="Remove NOIDA-ONF-18 from this campaign"/);
    expect(html).toContain("Add requisition");
    expect(html).toContain("Held for HR (1)");
    expect(html).toContain("99xxxxxx22");
    expect(html).not.toMatch(/\d{10}/);
    expect(html).toContain("relative overflow-x-auto");
  });
  it("view-only roles see the list without controls", () => {
    const html = renderToStaticMarkup(<CampaignRequisitionsView {...base} canWrite={false} />);
    expect(html).not.toContain("Make main");
    expect(html).not.toContain("Add requisition");
    expect(html).not.toContain("Place on");
  });
  it("removing the main requisition asks first and says what happens", () => {
    const html = renderToStaticMarkup(<CampaignRequisitionsView {...base} confirmRemove="r1" />);
    expect(html).toContain("NOIDA-ONF-17 is the main requisition");
    expect(html).toContain("Remove it");
    // a real (Radix) alert dialog: focus moves in, is trapped and goes back on close; Keep it is the safe default focus
    expect(html).toMatch(/role="alertdialog"[^>]*data-state="open"[^>]*tabindex="-1"/);
    expect(html).toContain('data-dialog-cancel="">Keep it');
  });
  it("loading, error with Retry", () => {
    expect(renderToStaticMarkup(<CampaignRequisitionsView {...base} links={null} loading />)).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<CampaignRequisitionsView {...base} links={null} error="boom" />)).toContain("Retry");
  });
});

describe("placement", () => {
  it("the campaign drawer mounts the editor above the criteria block", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../MetaCampaignDashboard.tsx", import.meta.url), "utf8");
    expect(src.indexOf("<CampaignRequisitionsEditor")).toBeGreaterThan(-1);
    expect(src.indexOf("<CampaignRequisitionsEditor")).toBeLessThan(src.indexOf("<CampaignCriteria key"));
  });
});
