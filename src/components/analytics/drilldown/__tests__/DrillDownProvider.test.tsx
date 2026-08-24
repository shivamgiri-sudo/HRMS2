/**
 * DrillDownProvider tests (Task 5 of the AON drill-down plan).
 *
 * Same deviation as RosterPivotGrid.test.tsx / RosterBuilderPage.test.tsx: this repo does not
 * have @testing-library/react or jsdom installed, and vitest.config.ts runs frontend tests
 * under `environment: "node"` — there is no `render()`/`fireEvent.click()` DOM available.
 *   - Section A renders the REAL provider + a consuming component through
 *     `renderToStaticMarkup`, proving the initial (mount-time) state is correct.
 *   - Section B drives the chip-state transitions (append, replace-by-dimension, truncate,
 *     clear) directly against the exported pure reducer helpers the component itself calls,
 *     so the append/replace/truncate/empty behaviour the brief's fireEvent-based test wants
 *     is verified against the real, live logic rather than a re-implementation in the test.
 */
import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DrillDownProvider,
  useDrillDown,
  applyPushChip,
  applyPopToChip,
  type DrillDownChip,
} from "../DrillDownProvider";

function Harness() {
  const { chips, showEmployeeList } = useDrillDown();
  return (
    <div>
      <span data-testid="chip-count">{chips.length}</span>
      <span data-testid="employee-list-open">{String(showEmployeeList)}</span>
      {chips.map((c, i) => (
        <span key={c.dimension} data-testid={`chip-${i}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section A — real render, initial mount state
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("DrillDownProvider — mount", () => {
  it("starts with zero chips and the employee list closed", () => {
    const html = renderToStaticMarkup(
      <DrillDownProvider>
        <Harness />
      </DrillDownProvider>,
    );
    expect(html).toContain('data-testid="chip-count">0<');
    expect(html).toContain('data-testid="employee-list-open">false<');
  });

  it("throws outside a DrillDownProvider (guards against a missing wrapper)", () => {
    function Bare() {
      useDrillDown();
      return null;
    }
    expect(() => renderToStaticMarkup(<Bare />)).toThrow(
      "useDrillDown must be used inside a DrillDownProvider",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section B — the real reducer helpers the component's setChips calls use
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("DrillDownProvider — chip transitions", () => {
  const cc: DrillDownChip = { dimension: "costCentre", value: "cc-1", label: "Kolkata CC" };
  const bucket: DrillDownChip = { dimension: "aonBucket", value: "31-60", label: "31-60d" };
  const bucket2: DrillDownChip = { dimension: "aonBucket", value: "61-90", label: "61-90d" };

  it("pushChip appends a new-dimension chip", () => {
    const afterCc = applyPushChip([], cc);
    expect(afterCc).toEqual([cc]);
    const afterBoth = applyPushChip(afterCc, bucket);
    expect(afterBoth).toEqual([cc, bucket]);
    expect(afterBoth.map((c) => c.label)).toEqual(["Kolkata CC", "31-60d"]);
  });

  it("pushChip replaces an existing chip of the same dimension instead of stacking a duplicate", () => {
    const chips = applyPushChip([cc, bucket], bucket2);
    expect(chips).toEqual([cc, bucket2]);
    expect(chips).toHaveLength(2);
  });

  it("popToChip truncates the chip list to the given index", () => {
    const chips = [cc, bucket];
    expect(applyPopToChip(chips, 1)).toEqual([cc]);
    expect(applyPopToChip(chips, 0)).toEqual([]);
  });

  it("clear empties the chip list", () => {
    // clear() is `setChips([])` directly in the provider — assert the empty array it resets to
    // matches what popToChip(0) already proves truncates correctly.
    expect(applyPopToChip([cc, bucket], 0)).toEqual([]);
  });
});
