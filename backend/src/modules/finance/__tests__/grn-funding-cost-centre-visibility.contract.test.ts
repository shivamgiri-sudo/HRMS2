import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}
function readRepo(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

/**
 * 2026-08-29: `funding_cost_centre_id` (migration 1630 — WHOSE BUDGET actually paid, as distinct
 * from `cost_centre_id`, WHO INCURRED the spend) was found to be read by ZERO P&L-facing query in
 * the whole process-pnl module. Not a double-count — each allocation row is still summed once —
 * but a real loss of the one fact that column exists to preserve, and specifically invisible to
 * the two people who most need it: the reviewer deciding whether to approve a GRN, and anyone
 * drilling into a budget line to see what actually drew on it.
 *
 * This pins the three places it was added, additively, with no existing figure changed:
 *   - grn-smart.service.ts loadAllocations() — feeds GET /grns/:id/workspace, which
 *     SmartGrnApprovalQueue.tsx (the approval screen) and BudgetGrnDrillDownDialog.tsx both call.
 *   - branch-budget.service.ts getGrnsForLine() — the per-budget-line GRN drill-through, which is
 *     already scoped to ONE funding line, making "but who actually incurred it" the one fact this
 *     view could not otherwise show.
 *   - SmartGrnApprovalQueue.tsx's own render of the allocation table, so the reviewer sees it
 *     without a second lookup.
 *
 * budgetCostCentreUtilizationService's own fundedElsewhere/fundingSources addition (the fourth
 * surface) is behaviourally tested in budget-cost-centre-funding-source.test.ts instead — its
 * logic is real aggregation, not a straight column read, and deserves a driven test rather than a
 * source-text one.
 */
describe("funding_cost_centre_id surfaced where a person actually looks", () => {
  it("loadAllocations() resolves the funding cost centre's NAME, not just the raw id", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    const fn = service.slice(service.indexOf("async function loadAllocations("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    // a.* already carries the raw funding_cost_centre_id column (migration 1630) — what was
    // missing was resolving it to something a reviewer can read without a second query.
    expect(body).toContain("LEFT JOIN cost_centre_master funding_ccm ON funding_ccm.id = a.funding_cost_centre_id");
    expect(body).toContain("funding_ccm.cost_centre_name AS funding_cost_centre_name");
  });

  it("getGrnsForLine() names WHO INCURRED the spend, on a view already scoped to WHOSE BUDGET paid", () => {
    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = service.slice(service.indexOf("async getGrnsForLine("));
    const body = fn.slice(0, fn.indexOf("\n  },\n"));
    // Every row here is filtered by `ca.budget_line_id = ?` — one specific funding line — so the
    // caller already knows who paid. The missing half was who the spend actually belonged to.
    expect(body).toContain("WHERE ca.budget_line_id = ?");
    expect(body).toContain("ca.cost_centre_id AS incurred_cost_centre_id");
    expect(body).toContain("LEFT JOIN cost_centre_master incurred_ccm ON incurred_ccm.id = ca.cost_centre_id");
  });

  it("the approval screen shows 'funded from X' only when it actually differs from the row's own cost centre", () => {
    const form = readRepo("src/components/finance/grn/SmartGrnApprovalQueue.tsx");
    // Conditioned on inequality (or a NULL funding centre — the branch pool), not shown
    // unconditionally: a row funded by its own cost centre must read exactly as it always has.
    expect(form).toContain("alloc.funding_cost_centre_id == null");
    expect(form).toContain('String(alloc.funding_cost_centre_id) !== String(alloc.cost_centre_id ?? "")');
    expect(form).toContain("funded from {alloc.funding_cost_centre_name ?? \"branch pool\"}");
  });
});
