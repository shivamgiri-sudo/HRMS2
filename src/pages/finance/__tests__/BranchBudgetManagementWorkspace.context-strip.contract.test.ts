import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Group G (item 13): the branch selector used to live ONLY inside the Plan Builder tab's own
 * Card, so every other tab (Variance, Cost Centre, Coverage, Matrix, Approval, ...) could show
 * budget-dependent content but had no way to actually choose a branch — a user landing on any
 * tab but Plan Builder saw only a read-only branch name and no way to change it.
 *
 * Fix: move the branch <select> (exact JSX, exact onChange, exact disabled={branchLocked}) into
 * the context strip that already renders above every tab, and make that strip's render guard
 * unconditional so it doubles as the selection control on every tab, not just a display of an
 * already-made choice.
 */

const SOURCE = readFileSync(new URL("../BranchBudgetManagementWorkspace.tsx", import.meta.url), "utf8");

/** The context strip block — from its leading comment to the ACTION REQUIRED banner comment. */
const CONTEXT_STRIP = (() => {
  const start = SOURCE.indexOf("{/* Context strip");
  expect(start, "context strip comment must still exist").toBeGreaterThan(-1);
  const end = SOURCE.indexOf("{/* ACTION REQUIRED banner", start);
  expect(end, "ACTION REQUIRED banner must still follow the context strip").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
})();

/** The Plan Builder tab's own content, from its TabsContent open tag to the next TabsContent. */
const PLAN_BUILDER_TAB = (() => {
  const start = SOURCE.indexOf('<TabsContent value="plan"');
  expect(start, "Plan Builder TabsContent must still exist").toBeGreaterThan(-1);
  const end = SOURCE.indexOf("<TabsContent value=", start + 1);
  expect(end, "a following TabsContent must exist").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
})();

describe("branch selector lives in the always-visible context strip", () => {
  it("the context strip renders the branch <select>, not just a read-only branch name", () => {
    expect(CONTEXT_STRIP).toContain("<select");
    expect(CONTEXT_STRIP).toContain('<option value="">Select branch</option>');
    expect(CONTEXT_STRIP).toContain("branches.map((branch)");
  });

  it("preserves the exact disabled/label wiring for branch-locked roles", () => {
    expect(CONTEXT_STRIP).toContain("disabled={branchLocked}");
    expect(CONTEXT_STRIP).toContain('{branchLocked ? "Assigned branch" : "Branch *"}');
  });

  it("preserves the onChange logic verbatim, including the dirty-navigation guard", () => {
    expect(CONTEXT_STRIP).toContain("if (canEdit && dirtyCount > 0)");
    expect(CONTEXT_STRIP).toContain('setPendingNavigation({ type: "branch", value: v });');
    expect(CONTEXT_STRIP).toContain("setBranchId(v);");
    expect(CONTEXT_STRIP).toContain("setSavedBudgetId(null);");
    expect(CONTEXT_STRIP).toContain("setLoadedDetailId(null);");
  });

  it("still renders the period control and status badge alongside the branch select", () => {
    expect(CONTEXT_STRIP).toContain("<MonthYearPicker");
    expect(CONTEXT_STRIP).toContain("{currentBudget && <span>{statusBadge(currentBudget.status)}</span>}");
  });

  it("the strip's render guard is no longer conditional on branchId/period being already set", () => {
    // It used to be `{(branchId || period) && (...)}` — now it must always render, since it is
    // the selection control itself, not a display of an already-made choice.
    expect(SOURCE).not.toMatch(/\{\(branchId \|\| period\) &&/);
  });
});

describe("the Plan Builder tab no longer has its own competing branch select", () => {
  it("removed the branch <select> from the Plan Builder card", () => {
    // The Plan Builder tab still has other, unrelated <select> elements further down (cost
    // centre / unit / tax-treatment pickers on each budget line) — those are out of scope here.
    // What must be gone is specifically the branch picker: its distinctive empty option and its
    // branchLocked-driven disabled/label wiring.
    expect(PLAN_BUILDER_TAB).not.toContain('<option value="">Select branch</option>');
    expect(PLAN_BUILDER_TAB).not.toContain('{branchLocked ? "Assigned branch" : "Branch *"}');
    expect(PLAN_BUILDER_TAB).not.toContain("disabled={branchLocked}");
  });

  it("kept the read-only Financial year display in the Plan Builder card", () => {
    expect(PLAN_BUILDER_TAB).toContain("<Label>Financial year</Label>");
    expect(PLAN_BUILDER_TAB).toContain("{financialYear(period)}");
  });
});
