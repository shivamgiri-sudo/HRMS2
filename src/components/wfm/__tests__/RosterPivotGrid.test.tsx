/**
 * RosterPivotGrid tests (Task 8 of the WFM Roster Builder plan).
 *
 * Same deviation and same two-section shape as RosterBuilderPage.test.tsx (Task 7):
 * @testing-library/react and jsdom are not installed in this repo and vitest.config.ts runs
 * frontend tests under `environment: "node"`, so there is no `render()`/`userEvent.click()`.
 *   - Section A renders the REAL component through `renderToStaticMarkup` with `hrmsApi`
 *     mocked at the module boundary and the react-query cache pre-seeded.
 *   - Section B asserts the pure helpers directly and the click-driven write wiring against
 *     the real, live source file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import RosterPivotGrid, { activeTemplates, toIsoDate, type GridRow, type ShiftTemplateOption } from "@/components/wfm/RosterPivotGrid";

const CYCLE = "cycle-1";
const PROCESS = "process-1";

function gridRow(overrides: Partial<GridRow> = {}): GridRow {
  return {
    employeeId: "emp-1",
    employeeName: "Jane Doe",
    rosterDate: "2026-08-24",
    assignmentId: "assign-1",
    shiftTemplateId: null,
    shiftTemplateName: null,
    isWeekOff: false,
    finalRosterStatus: null,
    ...overrides,
  };
}

function renderGrid(rows: GridRow[], templates: ShiftTemplateOption[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(["roster-builder", "grid", CYCLE, null, null], rows);
  client.setQueryData(["roster-builder", "shift-templates", PROCESS], templates);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RosterPivotGrid cycleId={CYCLE} processId={PROCESS} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section A — real render, real (mocked) API data flowing through the real component tree
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("RosterPivotGrid — rendering", () => {
  it("renders employee rows from the grid endpoint", () => {
    const html = renderGrid([gridRow()]);
    expect(html).toContain("Jane Doe");
    expect(html).toContain("2026-08-24");
  });

  it("renders the empty state when the cycle has no assignments", () => {
    const html = renderGrid([]);
    expect(html).toContain("No assignments yet");
  });

  it("renders a shift-template picker per assignable cell, with the assigned template selected", () => {
    const html = renderGrid(
      [gridRow({ shiftTemplateId: "tpl-1", shiftTemplateName: "Morning" })],
      [
        { id: "tpl-1", shift_code: "MOR", shift_name: "Morning", start_time: "09:00:00", end_time: "18:00:00", active_status: 1 },
        { id: "tpl-2", shift_code: "NGT", shift_name: "Night", start_time: "21:00:00", end_time: "06:00:00", active_status: 1 },
      ],
    );
    expect(html).toContain("Morning (09:00-18:00)");
    expect(html).toContain("Night (21:00-06:00)");
    expect(html).toContain('value="tpl-1" selected');
  });

  it("keeps an assignment pointing at an inactive/superseded template visible instead of blanking the cell", () => {
    const html = renderGrid(
      [gridRow({ shiftTemplateId: "tpl-retired", shiftTemplateName: "Retired Split" })],
      [{ id: "tpl-1", shift_code: "MOR", shift_name: "Morning", active_status: 1 }],
    );
    expect(html).toContain("Retired Split");
    expect(html).toContain('value="tpl-retired" selected');
  });

  it("shows WO for a week-off cell and offers no picker there", () => {
    const html = renderGrid(
      [gridRow({ isWeekOff: true })],
      [{ id: "tpl-1", shift_code: "MOR", shift_name: "Morning", active_status: 1 }],
    );
    expect(html).toContain("WO");
    expect(html).not.toContain("Shift for Jane Doe on 2026-08-24");
  });

  it("warns and disables the pickers when the process has no active shift templates", () => {
    const html = renderGrid([gridRow()], []);
    expect(html).toContain("No active shift templates exist for this process");
    expect(html).toContain("disabled");
  });

  it("aligns columns across employees with different date coverage (real pivot, not row order)", () => {
    const html = renderGrid([
      gridRow({ employeeId: "emp-1", employeeName: "Jane Doe", rosterDate: "2026-08-24" }),
      gridRow({ employeeId: "emp-1", employeeName: "Jane Doe", rosterDate: "2026-08-25", assignmentId: "assign-2" }),
      gridRow({ employeeId: "emp-2", employeeName: "John Roe", rosterDate: "2026-08-25", assignmentId: "assign-3" }),
    ]);
    // Two date columns in the header, and John Roe's 24th is an explicit empty cell, so his
    // 25th sits under the 25th column rather than sliding left into the 24th.
    expect(html).toContain("2026-08-24");
    expect(html).toContain("2026-08-25");
    expect(html).toContain("·");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section B — helpers and write-path wiring
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("RosterPivotGrid — helpers", () => {
  it("normalises a date-with-time back to the calendar date used as the column key", () => {
    expect(toIsoDate("2026-08-24")).toBe("2026-08-24");
    expect(toIsoDate("2026-08-24T00:00:00.000Z")).toBe("2026-08-24");
    expect(toIsoDate("2026-08-24 00:00:00")).toBe("2026-08-24");
  });

  it("keeps only the newest active version of each shift_code", () => {
    const kept = activeTemplates([
      { id: "v2", shift_code: "MOR", shift_name: "Morning v2", version: 2, active_status: 1 },
      { id: "v1", shift_code: "MOR", shift_name: "Morning v1", version: 1, active_status: 1 },
      { id: "off", shift_code: "NGT", shift_name: "Night", version: 1, active_status: 0 },
      { id: "eve", shift_code: "EVE", shift_name: "Evening", version: 1, active_status: 1 },
    ]);
    expect(kept.map((t) => t.id)).toEqual(["v2", "eve"]);
  });
});

describe("RosterPivotGrid — write path", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/wfm/RosterPivotGrid.tsx"), "utf8");
  // The file's own header documents why the brief's window.prompt placeholder was dropped, so a
  // plain text search would match the explanation rather than any real call. Strip comments first.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("posts through hrmsApi (auth-bearing), not a bare fetch that would 401 behind requireAuth", () => {
    expect(source).toContain('hrmsApi.post("/api/wfm/roster-builder/assign"');
    expect(source).not.toMatch(/(?<!\/\/.*)\bawait fetch\(/);
    expect(source).not.toMatch(/global\.fetch|window\.fetch/);
  });

  it("ships a real picker — no window.prompt placeholder reaches the page", () => {
    expect(code).not.toContain("window.prompt");
    expect(code).toContain("<select");
  });

  it("sends cycleId with every cell write so the assignment lands in the cycle", () => {
    expect(source).toContain("{ ...input, cycleId }");
  });

  it("sources picker options from the existing unmodified shift-template endpoint", () => {
    expect(source).toContain("/api/roster-gov/shifts/templates?process_id=");
  });

  it("invalidates the grid query and notifies the parent after a successful write", () => {
    expect(source).toContain('invalidateQueries({ queryKey: ["roster-builder", "grid", cycleId] })');
    expect(source).toContain("onAssigned?.()");
  });

  it("does not re-post when the picker fires with the value already on the cell", () => {
    expect(source).toContain("shiftTemplateId === cell.shiftTemplateId) return;");
  });
});

describe("RosterBuilderPage — grid wiring", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "src/pages/wfm/RosterBuilderPage.tsx"), "utf8");

  it("mounts the grid once a cycle exists, replacing the Task 7 placeholder", () => {
    expect(pageSource).toContain("RosterPivotGrid");
    expect(pageSource).not.toContain("roster-builder-grid-placeholder");
  });

  it("passes the picked processId through so the template endpoint has its required scope", () => {
    expect(pageSource).toMatch(/<RosterPivotGrid[^>]*processId=\{processId\}/s);
  });
});
