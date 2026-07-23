import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = readFileSync(resolve(process.cwd(), "src/modules/it-provisioning/it-provisioning.routes.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/modules/it-provisioning/it-provisioning.service.ts"), "utf8");

describe("IT provisioning dashboard scope", () => {
  it("resolves functional queues through canonical dashboard scope", () => {
    expect(routes).toContain("resolveDashboardScope");
    expect(routes).toContain("narrowDashboardScope");
    expect(routes).toContain("filters.branchIds = scoped.branchIds");
    expect(routes).toContain("router.get('/stats'");
    expect(routes).toContain("getProvisioningStats");
  });

  it("supports all assigned branches instead of one caller-controlled branch", () => {
    expect(service).toContain("branchIds?: string[]");
    expect(service).toContain("e.branch_id IN");
  });
});
