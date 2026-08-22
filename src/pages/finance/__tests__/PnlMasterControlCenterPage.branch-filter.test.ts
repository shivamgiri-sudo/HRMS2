import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Same bug pattern as GrnSearchWorkspace and CEO Overview (a0460152): this page's Process
 * dropdowns list every process regardless of the branch a form is scoped to, because
 * `/pnl/config/reference-data` returns an unscoped list and has no branch-filtering capability
 * server-side (out of scope to add here — see task brief). The Allocation-policy form already
 * carries its own client-side fix: `processes.filter((process) => !form.branchId ||
 * process.branch_id === form.branchId)`. This applies the identical pattern to the other forms
 * on this page that have their own branchId field: Cost-component and Classification. It also
 * covers the reward/penalty Cost Centre dropdown, which now passes branchFilter through to
 * useCostCentreList (that endpoint already supports branch_id server-side).
 *
 * NOT covered here — flagged in the task report rather than guessed at: the Revenue-rule,
 * Delivery, and Revenue-component forms/payloads (RevenueRulePayload, DeliveryActualPayload,
 * RevenueComponentPayload in useBpoPnlConfiguration.ts) carry no branchId field at all, so
 * there is no per-form value to filter their Process dropdowns against without inventing new
 * UI-only state that isn't part of this fix's scope.
 *
 * No test file previously existed for this page (1500+ lines, no rendering harness set up for
 * it) — this is a source-text contract check, matching the established convention already used
 * for GrnSearchWorkspace in this same delta (grn-process-filter-scope.test.ts), not a new
 * testing approach invented for this file.
 */

const SRC = readFileSync(
  new URL("../PnlMasterControlCenterPage.tsx", import.meta.url),
  "utf8",
);

describe("PnlMasterControlCenterPage — Process dropdowns scoped to their form's branch", () => {
  it("Cost-component form filters processes by costForm.branchId", () => {
    expect(SRC).toMatch(
      /processes=\{processes\.filter\(\(process\) => !costForm\.branchId \|\| process\.branch_id === costForm\.branchId\)\}/
    );
  });

  it("Classification form filters processes by classificationForm.branchId", () => {
    expect(SRC).toMatch(
      /processes=\{processes\.filter\(\(process\) => !classificationForm\.branchId \|\| process\.branch_id === classificationForm\.branchId\)\}/
    );
  });

  it("Allocation-policy form's original pattern is untouched (reference implementation, not part of this fix)", () => {
    expect(SRC).toMatch(
      /processes=\{processes\.filter\(\(process\) => !allocationForm\.branchId \|\| process\.branch_id === allocationForm\.branchId\)\}/
    );
  });

  it("passes branchFilter through to useCostCentreList so the reward/penalty Cost Centre dropdown is branch-scoped", () => {
    expect(SRC).toMatch(
      /useCostCentreList\(\{\s*status:\s*["']active["'],\s*branch_id:\s*branchFilter \|\| undefined\s*\}\)/
    );
  });
});
