import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}
function readFrontend(relativePath: string) {
  return fs.readFileSync(path.resolve(backendRoot, "..", relativePath), "utf8");
}

const SERVICE = "src/modules/process-pnl/budget-cost-centre-utilization.service.ts";
const WORKSPACE = "src/pages/finance/BranchBudgetManagementWorkspace.tsx";

/**
 * Production 2026-08-17: the Cost Centre tab on /finance/branch-budget showed 2 rows for NOIDA-2's
 * active 2026-08 budget, where 6 cost centres actually hold budget. It aggregated in the browser
 * over finance_budget_line.cost_centre_id, which is NULL for every branch-level line by design —
 * those lines keep their per-cost-centre split in finance_budget_line_allocation. 85 of 117 lines
 * were branch-level, so Rs 1,310,261 across 5 further cost centres collapsed into a single
 * "Branch Common" row.
 */
describe("cost-centre budget utilization", () => {
  it("unions BOTH budget sources, so allocated cost centres are not lost", () => {
    const service = read(SERVICE);
    // The direct half.
    expect(service).toContain("FROM finance_budget_line l");
    expect(service).toContain("l.cost_centre_id IS NOT NULL");
    // The half that was missing entirely.
    expect(service).toContain("JOIN finance_budget_line_allocation a ON a.budget_line_id = l.id");
    expect(service).toContain("l.cost_centre_id IS NULL");
    expect(service).toContain("UNION ALL");
  });

  it("cannot double-count a line into both halves of the union", () => {
    const service = read(SERVICE);
    // The two branches must be split on the same column's nullity, which makes them disjoint by
    // construction rather than by luck. Verified against production: 0 direct lines also carry
    // allocation rows, so a line contributes to exactly one arm.
    const directIdx = service.indexOf("l.cost_centre_id IS NOT NULL");
    const allocIdx = service.indexOf("l.cost_centre_id IS NULL");
    expect(directIdx).toBeGreaterThan(-1);
    expect(allocIdx).toBeGreaterThan(directIdx);
  });

  it("measures spend from grn_cost_allocation rather than pro-rating it", () => {
    const service = read(SERVICE);
    expect(service).toContain("FROM grn_cost_allocation g");
    // Attributed on the GRN's OWN cost centre.
    expect(service).toContain("g.cost_centre_id");
    // Only money that is actually committed counts: a draft GRN reserves nothing, and
    // released/reversed rows have given it back.
    expect(service).toContain("g.lifecycle_status IN ('reserved', 'consumed')");
    // No allocation_percentage-based spreading of a line total across cost centres.
    expect(service).not.toMatch(/consumed[\s\S]{0,80}allocation_percentage/);
  });

  it("keeps unattributed GRN spend in its own row instead of spreading it", () => {
    const service = read(SERVICE);
    expect(service).toContain("isUnattributed");
    // It must be visibly labelled, not silently folded into a real cost centre.
    expect(service).toContain("Unattributed");
    const workspace = readFrontend(WORKSPACE);
    expect(workspace).toContain("no cost centre on the GRN");
  });

  it("counts distinct lines, not union rows", () => {
    const service = read(SERVICE);
    // An allocated line appears once per cost centre it touches. Counting rows would inflate the
    // line count of every branch-level budget.
    expect(service).toContain("_lines");
    expect(service).toContain("_lines.size");
  });

  it("enforces role and branch row scope on the endpoint", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain("/pnl/budgets/:id/cost-centre-utilization");
    const idx = routes.indexOf("/pnl/budgets/:id/cost-centre-utilization");
    const block = routes.slice(idx, idx + 900);
    expect(block).toContain("BUDGET_READ_ROLES");
    // Scope must be asserted before any figure is read, same as every other budget endpoint.
    const scopeIdx = block.indexOf("assertFinanceRecordBranch");
    const readIdx = block.indexOf("budgetCostCentreUtilizationService.get(");
    expect(scopeIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(scopeIdx);
  });

  it("refusals carry a statusCode so production does not mask them", () => {
    const service = read(SERVICE);
    const code = service.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/throw new Error\(/);
    expect(service).toContain("statusCode: 404");
  });

  /** The tab previously rendered a flat table whose rows carried hover styling but no handler, so
   *  the head/sub-head detail people tried to click simply did not exist. */
  it("the Cost Centre tab drills into head / sub-head detail", () => {
    const workspace = readFrontend(WORKSPACE);
    expect(workspace).toContain("expandedCostCentres");
    expect(workspace).toContain("toggleCostCentre");
    expect(workspace).toContain("cc.heads.map");
    // Reachable without a mouse.
    expect(workspace).toContain('aria-expanded={isOpen}');
    expect(workspace).toMatch(/onKeyDown=\{\(event\) => \{[\s\S]{0,200}toggleCostCentre\(rowKey\)/);
  });

  it("the tab reads the server rollup, not the old browser-side cost_centre_id aggregation", () => {
    const workspace = readFrontend(WORKSPACE);
    expect(workspace).toContain("budget-cost-centre-utilization");
    // The defective memo keyed on the line's own cost_centre_id must be gone.
    expect(workspace).not.toContain('l.cost_centre_name ?? "Branch Common"');
  });
});
