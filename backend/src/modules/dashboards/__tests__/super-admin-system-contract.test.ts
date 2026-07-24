import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = readFileSync(resolve(process.cwd(), "src/modules/management/management.routes.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/modules/management/management.service.ts"), "utf8");

describe("super admin system dashboard contract", () => {
  it("explicitly permits super admin without granting business admins implicit access", () => {
    expect(routes).toContain(
      'router.get("/system-dashboard", requireRole("admin", "super_admin")',
    );
  });

  it("provides a system-health freshness timestamp", () => {
    expect(service).toContain("generatedAt: new Date().toISOString()");
  });

  it("does not full-scan every large module table for record counts", () => {
    const systemDashboard = service.slice(
      service.indexOf("async getSystemDashboard()"),
      service.indexOf("async getWorkforceDashboard("),
    );

    expect(systemDashboard).toContain("information_schema.TABLES");
    expect(systemDashboard).toContain("recordCountEstimated: true");
    expect(systemDashboard).not.toContain(
      "SELECT 'ATS' AS module_name, COUNT(*) AS record_count",
    );
  });

  it("loads independent workforce panels concurrently", () => {
    const workforceDashboard = service.slice(
      service.indexOf("async getWorkforceDashboard("),
      service.indexOf("async getSystemDashboard(") > service.indexOf("async getWorkforceDashboard(")
        ? service.indexOf("async getSystemDashboard(")
        : undefined,
    );

    expect(workforceDashboard).toContain("secondaryPanelResults = await Promise.all");
  });
});
