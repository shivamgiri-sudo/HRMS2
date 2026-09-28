import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackerGrid } from "../TrackerGrid";
import { cellCaption, formatDuration, STATUS_META } from "../trackerFormat";
import type { TrackerCell, TrackerResponse, UploadStatus } from "../trackerTypes";

const cell = (weekStart: string, status: UploadStatus, extra: Partial<TrackerCell> = {}): TrackerCell => ({
  weekStart, status, expected: 45, covered: status === "partial" ? 38 : status === "missing" || status === "due" ? 0 : 45,
  uploadedAtMs: null, hoursLate: null, hoursToDeadline: null, ...extra,
});

const counts = (over: Partial<Record<UploadStatus, number>> = {}): Record<UploadStatus, number> => ({
  uploaded: 0, delayed: 0, partial: 0, missing: 0, due: 0, ...over,
});

const DATA: TrackerResponse = {
  nowMs: Date.UTC(2026, 8, 21, 6, 30),
  weeks: [
    { weekStart: "2026-09-14", deadlineAtMs: Date.UTC(2026, 8, 13, 12, 30), isCurrent: false, counts: counts({ uploaded: 1, delayed: 1 }) },
    { weekStart: "2026-09-21", deadlineAtMs: Date.UTC(2026, 8, 20, 12, 30), isCurrent: true, counts: counts({ partial: 1, missing: 1 }) },
  ],
  branches: [
    {
      branchId: "b1", branchName: "NOIDA", wfm: [{ userId: "u1", employeeId: "e1", name: "Anita Sharma" }],
      processes: [
        {
          branchId: "b1", branchName: "NOIDA", processId: "p1", processName: "Housing",
          managers: [{ userId: "u2", employeeId: "e2", name: "Priya Nair" }],
          cells: [cell("2026-09-14", "delayed", { hoursLate: 14.5 }), cell("2026-09-21", "missing", { hoursLate: 16 })],
        },
        {
          branchId: "b1", branchName: "NOIDA", processId: "p2", processName: "Brand Sales",
          managers: [],
          cells: [cell("2026-09-14", "uploaded", { uploadedAtMs: Date.UTC(2026, 8, 12, 5, 40) }), cell("2026-09-21", "partial", { hoursLate: 16 })],
        },
      ],
    },
    { branchId: "b2", branchName: "Ahmedabad", wfm: [], processes: [] },
  ],
  filters: { branches: [], processes: [], managers: [] },
  summary: { currentWeek: counts(), nextWeek: counts() },
};

const render = (statusFilter: "all" | UploadStatus = "all") =>
  renderToStaticMarkup(<TrackerGrid data={DATA} statusFilter={statusFilter} selected={null} onSelect={() => undefined} />);

describe("TrackerGrid", () => {
  it("shows a chip per process and week with the status label and glyph", () => {
    const html = render();
    expect(html).toContain("Housing");
    expect(html).toContain("Brand Sales");
    for (const status of ["Uploaded", "Delayed", "Missing", "Partial"]) expect(html).toContain(status);
    expect(html).toContain("✕");
    expect(html).toContain("◷");
  });

  it("uses green for uploaded, orange for delayed, red for missing", () => {
    const html = render();
    expect(html).toContain("bg-emerald-100");
    expect(html).toContain("bg-orange-100");
    expect(html).toContain("bg-red-100");
  });

  it("shows coverage on a partial cell", () => {
    expect(render()).toContain("38/45");
  });

  it("shows the week header with deadline, THIS WEEK marker and missing count", () => {
    const html = render();
    expect(html).toContain("W/C 21 Sep");
    expect(html).toContain("THIS WEEK");
    expect(html).toContain("1 missing");
    expect(html).toContain("Deadline 20/09/2026 18:00");
  });

  it("names the branch WFM and process manager, and flags unmapped ones", () => {
    const html = render();
    expect(html).toContain("WFM · Anita Sharma");
    expect(html).toContain("Mgr · Priya Nair");
    expect(html).toContain("Mgr · not mapped");
    expect(html).toContain("WFM · not mapped");
  });

  it("dims cells that do not match the status filter instead of hiding the row", () => {
    const html = render("missing");
    expect(html).toContain("opacity-30");
    expect(html).toContain("Brand Sales");
  });

  it("says so when nothing matches", () => {
    const html = renderToStaticMarkup(
      <TrackerGrid data={{ ...DATA, branches: [] }} statusFilter="all" selected={null} onSelect={() => undefined} />,
    );
    expect(html).toContain("No branch or process matches these filters.");
  });
});

describe("cell captions", () => {
  it("describes lateness, overdue time and time left", () => {
    expect(cellCaption(cell("w", "delayed", { hoursLate: 14.5 }))).toBe("+15 h late");
    expect(cellCaption(cell("w", "missing", { hoursLate: 30 }))).toBe("1 d 6 h overdue");
    expect(cellCaption(cell("w", "due", { hoursToDeadline: 48 }))).toBe("due in 2 d");
    expect(cellCaption(cell("w", "uploaded", { uploadedAtMs: Date.UTC(2026, 8, 19, 5, 50) }))).toBe("Sat 11:20");
  });

  it("formats durations", () => {
    expect(formatDuration(5)).toBe("5 h");
    expect(formatDuration(24)).toBe("1 d");
  });

  it("gives every status a distinct look", () => {
    const looks = new Set(Object.values(STATUS_META).map((m) => m.cell));
    expect(looks.size).toBe(5);
  });
});
