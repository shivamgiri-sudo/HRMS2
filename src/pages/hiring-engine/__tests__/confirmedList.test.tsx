/** Confirmed to attend / arrival checklist: model + static markup (node env). Print and the dialog need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));

import { ConfirmedView } from "../responses/ConfirmedList";
import { arrivalOf, checklistHtml, confirmedRows, confirmedSummary, type DriveConfirmed } from "../responses/confirmedModel";

const r = (o: Partial<DriveConfirmed["rows"][number]>): DriveConfirmed["rows"][number] => ({
  matchId: "M1", leadId: "L1", name: "Ravi S.", mobileMasked: "xxxxxx6789", slotAt: "2026-10-09 11:00:00", confirmedVia: "web", confirmedAt: "2026-10-08 09:00:00",
  otherChannels: [], conflict: false, state: "confirmed", arrivedAt: null, ...o,
});
const data = (rows: DriveConfirmed["rows"]): DriveConfirmed => ({
  drive: { id: "D1", requisitionId: "R1", date: "2026-10-09", branch: "PUNE", status: "active", requisitionCode: "REQ-1", role: "Agent <Sales>", slotStart: "10:00:00", slotEnd: "17:30:00" },
  rows, counts: { total: rows.length, confirmed: rows.filter((x) => x.state === "confirmed").length, arrived: rows.filter((x) => x.state === "arrived").length, noShow: 0, conflicts: rows.filter((x) => x.conflict).length },
});
const D = data([
  r({ matchId: "M2", name: "Neha", slotAt: "2026-10-09 10:30:00", confirmedVia: "whatsapp", otherChannels: ["web", "voice_bot"], state: "arrived", arrivedAt: "2026-10-09 10:20:00" }),
  r({}), r({ matchId: "M3", name: "Om P.", slotAt: null, confirmedVia: null, state: "declined", conflict: true }),
]);
const noop = () => undefined;
const view = (p: Partial<React.ComponentProps<typeof ConfirmedView>> = {}) =>
  renderToStaticMarkup(<ConfirmedView data={D} loading={false} error={null} canWrite onRetry={noop} onPrint={noop} onMark={noop} onOpen={noop} {...p} />);

describe("confirmedRows", () => {
  it("by slot (no slot last), channel words, other channels, arrival and conflict", () => {
    const rows = confirmedRows(D);
    expect(rows.map((x) => [x.slot, x.name, x.via, x.also, x.arrivalText, x.conflict])).toEqual([
      ["10:30", "Neha", "WhatsApp", "Email button, Voice bot", "Arrived 10:20", false],
      ["11:00", "Ravi S.", "Email button", "", "Expected", false],
      ["–", "Om P.", "Before tracking", "", "Changed answer", true],
    ]);
  });
  it("arrival states", () => {
    expect(["arrived", "selected", "no_show", "confirmed", "declined", "slot_released"].map(arrivalOf)).toEqual(["arrived", "arrived", "no_show", "expected", "changed", "changed"]);
  });
  it("summary line", () => expect(confirmedSummary(D)).toBe("3 confirmed · 1 arrived · 0 no-show · 1 changed their answer"));
});

describe("ConfirmedView", () => {
  it("table with caption, masked mobiles, status as icon + word, conflict in words", () => {
    const html = view();
    expect(html).toContain("Confirmed to attend (3)");
    expect(html).toContain("<caption");
    expect(html).toContain("xxxxxx6789");
    expect(html).not.toMatch(/\d{10}/);
    expect(html).toContain("Conflict: answered differently later");
    expect(html).toContain("Print checklist");
  });
  it("write role: Record answer on people who have not arrived; view-only: none", () => {
    expect((view().match(/Record an answer for/g) ?? []).length).toBe(2);
    expect(view({ canWrite: false })).not.toContain("Record an answer for");
    expect(view({ canWrite: false })).toContain("Timeline of Neha");
  });
  it("empty, loading and error states", () => {
    expect(view({ data: data([]) })).toContain("No one has confirmed for this drive yet.");
    expect(view({ data: null, loading: true })).toContain('aria-label="Loading the confirmed list"');
    expect(view({ data: null, error: "boom" })).toContain("Retry");
  });
});

describe("checklistHtml", () => {
  it("one row per person with a tick column, escaped, masked", () => {
    const html = checklistHtml(D);
    expect((html.match(/<td class="tick"><\/td>/g) ?? []).length).toBe(3);
    expect(html).toContain("Agent &lt;Sales&gt;");
    expect(html).not.toMatch(/\d{10}/);
    expect(html).toContain("Changed answer (check)");
  });
});
