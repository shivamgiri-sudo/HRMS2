import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");

function source(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("P&L Master & Control Center UI contract", () => {
  const page = source("src/pages/finance/PnlMasterControlCenterPage.tsx");
  const routeBridge = source("src/pages/finance/ProcessPnlConfigurationPage.tsx");
  const hook = source("src/hooks/useBpoPnlConfiguration.ts");

  it("keeps the existing configuration route connected to the master center", () => {
    expect(routeBridge).toContain('export { default } from "./PnlMasterControlCenterPage"');
  });

  it("provides the governed master workspaces required by Finance", () => {
    expect(page).toContain("P&L Master & Control Center");
    expect(page).toContain('value="overview"');
    expect(page).toContain('value="commercial"');
    expect(page).toContain('value="delivery"');
    expect(page).toContain('value="costs"');
    expect(page).toContain('value="allocation"');
    expect(page).toContain('value="classification"');
    expect(page).toContain('value="plans"');
    expect(page).toContain('value="governance"');
  });

  it("surfaces health, exceptions and impact before a master is changed", () => {
    expect(page).toContain("Configuration health");
    expect(page).toContain("Master impact simulator");
    expect(page).toContain("Unmapped process queue");
    expect(page).toContain("Commercial gaps");
    expect(page).toContain("Allocation exceptions");
    expect(page).toContain("manual allocation pools are balanced");
  });

  it("keeps every supported P&L master save workflow available", () => {
    expect(page).toContain("saveRevenueRule.mutateAsync");
    expect(page).toContain("saveDeliveryActual.mutateAsync");
    expect(page).toContain("saveRevenueComponent.mutateAsync");
    expect(page).toContain("saveCostComponent.mutateAsync");
    expect(page).toContain("saveAllocationPolicy.mutateAsync");
    expect(page).toContain("saveClassificationRule.mutateAsync");
    expect(page).toContain("saveContract.mutateAsync");
    expect(page).toContain("saveRate.mutateAsync");
    expect(page).toContain("saveMonthlyPlan.mutateAsync");
  });

  it("uses the live Finance APIs rather than mock or local-only persistence", () => {
    expect(hook).toContain("/api/finance/pnl/bpo/revenue-rules");
    expect(hook).toContain("/api/finance/pnl/bpo/delivery-actuals");
    expect(hook).toContain("/api/finance/pnl/bpo/revenue-components");
    expect(hook).toContain("/api/finance/pnl/bpo/cost-components");
    expect(hook).toContain("/api/finance/pnl/bpo/allocation-policies");
    expect(hook).toContain("/api/finance/pnl/bpo/classification-rules");
    expect(page).not.toContain("localStorage.setItem");
  });
});
