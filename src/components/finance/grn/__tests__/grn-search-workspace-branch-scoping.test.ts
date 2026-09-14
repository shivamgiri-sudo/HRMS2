import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * GrnSearchWorkspace's Process and Cost Centre dropdowns previously fetched with a fixed
 * queryKey (["org-processes"] / ["org-cost-centres"]) and no branch_id param, so picking a
 * branch in the search form never narrowed either list — the same bug pattern fixed on CEO
 * Overview in a0460152, found on this page during that investigation.
 *
 * Bound to draft.branchId (not applied.branchId) deliberately: this is a dependent-dropdown,
 * narrowing Process/Cost Centre options as soon as a branch is picked, before "Apply" is
 * clicked elsewhere on this page.
 *
 * This directory has no interactive-rendering setup (see grn-process-filter-scope.test.ts's
 * own comment on why — no jsdom/@testing-library here), so this asserts on source text,
 * matching that file's established convention for this directory.
 */

const SRC = readFileSync(
  new URL("../GrnSearchWorkspace.tsx", import.meta.url),
  "utf8",
);

describe("GrnSearchWorkspace — Process/Cost Centre scoped to the selected branch", () => {
  it("keys the processes query on draft.branchId so branch changes trigger a refetch", () => {
    expect(SRC).toMatch(/queryKey:\s*\[\s*["']org-processes["']\s*,\s*draft\.branchId\s*\]/);
  });

  it("keys the cost centres query on draft.branchId so branch changes trigger a refetch", () => {
    expect(SRC).toMatch(/queryKey:\s*\[\s*["']org-cost-centres["']\s*,\s*draft\.branchId\s*\]/);
  });

  it("sends branch_id to the processes endpoint when a branch is selected", () => {
    expect(SRC).toMatch(/\/api\/org\/processes\?limit=200&branch_id=\$\{draft\.branchId\}/);
  });

  it("sends branch_id to the cost-centres endpoint when a branch is selected", () => {
    expect(SRC).toMatch(/\/api\/org\/cost-centres\?limit=500&active_status=1&branch_id=\$\{draft\.branchId\}/);
  });

  it("still falls back to the unscoped URL when no branch is selected — 'Any branch' must not 404 or send an empty param", () => {
    expect(SRC).toContain('"/api/org/processes?limit=200"');
    expect(SRC).toContain('"/api/org/cost-centres?limit=500&active_status=1"');
  });
});
