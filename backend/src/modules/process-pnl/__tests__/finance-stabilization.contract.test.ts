import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

// 2026-07-29 stabilization pass. Regression tests for the drift found by the finance audit:
// a shadowed budget-submit route, a dead unsafe lockPeriod, a manifest gap, duplicated float
// allocation math, and legacy-vs-canonical profit drift on the process detail routes.

describe("budget submit/create routes are owned by exactly one router", () => {
  it("does not re-register POST /pnl/budgets or POST /pnl/budgets/:id/submit in process-pnl.routes.ts", () => {
    const processPnlRoutes = read("src/modules/process-pnl/process-pnl.routes.ts");
    // These two paths must be registered exactly once across the finance router stack — by
    // budgetCoverageRouter (budget-coverage.routes.ts), which is mounted ahead of processPnlRouter
    // and additionally enforces Head/Sub-head coverage completeness before submit. Re-adding them
    // here would silently resurrect a shadowed dead-code route (Express resolves to whichever
    // router registered the path first).
    expect(processPnlRoutes).not.toMatch(/router\.post\(\s*"\/pnl\/budgets"/);
    expect(processPnlRoutes).not.toMatch(/router\.post\(\s*"\/pnl\/budgets\/:id\/submit"/);
    // The review route (a different path, no collision) must still be present.
    expect(processPnlRoutes).toContain('"/pnl/budgets/:id/review"');
  });

  it("budget-coverage.routes.ts remains the sole owner of create/submit", () => {
    const budgetCoverageRoutes = read("src/modules/process-pnl/budget-coverage.routes.ts");
    expect(budgetCoverageRoutes).toContain('"/pnl/budgets"');
    expect(budgetCoverageRoutes).toContain('"/pnl/budgets/:id/submit"');
  });
});

describe("governance service no longer exposes a dead, unsafe lockPeriod/recalculate", () => {
  it("removes the unreachable lockPeriod/recalculate that skipped snapshotting", () => {
    const governance = read("src/modules/process-pnl/process-pnl.governance.service.ts");
    // canonicalPnlService.lockPeriod is the only reachable lock path (wired from
    // process-pnl.routes.ts) and is the one that writes pnl_period_snapshot/
    // pnl_period_snapshot_row before flipping finance_period.status. The governance-service
    // copy had zero callers and no snapshot/pending-adjustment safety check.
    expect(governance).not.toMatch(/async lockPeriod\(/);
    expect(governance).not.toMatch(/async recalculate\(/);
  });

  it("canonicalPnlService remains the single lock/recalculate entry point", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain("canonicalPnlService.lockPeriod");
    expect(routes).toContain("canonicalPnlService.recalculate");
  });
});

describe("migration manifest gap closure", () => {
  it("includes 424_employee_reimbursement_claim.sql in the governed manifest", () => {
    const manifest = read("src/db/runPendingMigrations.ts");
    expect(manifest).toContain('"424_employee_reimbursement_claim.sql"');
  });
});

describe("legacy vs canonical profit figures on process detail routes", () => {
  it("overlays canonical EBITDA/EBIT/PBT/PAT-derived profit fields onto the legacy overview/detail responses", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain("fetchCanonicalProfitRow");
    expect(routes).toContain("mergeCanonicalProfit");
    expect(routes).toContain("calculationEngine: \"bpo_allocation_v2\"");
    expect(routes).toContain("calculationEngine: \"legacy_fallback\"");
  });
});

describe("shared decimal-safe allocation primitive", () => {
  it("both allocation call sites delegate to the single shared allocatePoolAmount function", () => {
    const bpoPnlService = read("src/modules/process-pnl/bpo-pnl.service.ts");
    const overlayService = read("src/modules/process-pnl/bpo-pnl-allocation-overlay.service.ts");
    expect(bpoPnlService).toContain("allocatePoolAmount(");
    expect(overlayService).toContain("allocatePoolAmount(");
    // Neither call site should still do its own raw proportional float division —
    // that logic now lives once in bpo-pnl.calculation.ts.
    expect(bpoPnlService).not.toMatch(/poolAmount \* \(values\[index\] \/ total\)/);
    expect(overlayService).not.toMatch(/amount \* \(values\[index\] \/ total\)/);
  });
});
