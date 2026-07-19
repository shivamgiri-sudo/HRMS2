import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("application shell routing contracts", () => {
  const appSource = read("src/App.tsx");
  const navSource = read("src/components/layout/navConfig.tsx");
  const routeSource = [
    "public",
    "dashboards",
    "people",
    "recruitment",
    "workforce",
    "payroll",
    "performance",
    "compliance",
    "finance",
    "platform",
    "portal",
    "visitor",
  ]
    .map((group) => read(`src/config/routes/${group}.routes.tsx`))
    .join("\n");

  it("mounts the canonical route elements and authenticated Copilot widget", () => {
    expect(appSource).toContain('import { appRouteElements } from "./config/routes"');
    expect(appSource).toContain("{appRouteElements}");
    expect(appSource).toContain("<FloatingChatWidget />");
  });

  it("keeps every configured sidebar destination backed by a route", () => {
    const navPaths = [...navSource.matchAll(/href:\s*"([^"]+)"/g)]
      .map((match) => match[1].split("?")[0])
      .filter((path, index, all) => path.startsWith("/") && all.indexOf(path) === index);
    const routePaths = new Set(
      [...routeSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]),
    );

    expect(navPaths.filter((path) => !routePaths.has(path))).toEqual([]);
  });

  it("keeps sales performance out of shared role dashboards", () => {
    const referenceDashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");
    const roleDashboard = read("src/pages/dashboards/RoleDashboardV3.tsx");

    expect(referenceDashboard).not.toContain("RoleSalesPerformancePanel");
    expect(roleDashboard).not.toContain("RoleSalesPerformancePanel");
  });

  it("uses the available new-joiner metric for the onboarding employee card", () => {
    const employeeHookSource = read("src/hooks/useEmployees.ts");

    expect(employeeHookSource).toContain("stats.onboarding_employees ?? stats.new_joiners_90d ?? 0");
  });

  it("loads WFM device health from the mounted COSEC monitoring API", () => {
    const referenceDashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");

    expect(referenceDashboard).toContain("/api/integrations/cosec/sync-status");
    expect(referenceDashboard).not.toContain("/api/wfm/biometric-summary/device-status");
  });
});
