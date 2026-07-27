import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PAGE_CODE_BY_ROUTE,
  PAGE_CODE_BY_ROUTE_PATTERN,
} from "@/lib/pageRoutePageCodes";
import { DASHBOARD_ACCESS_REGISTRY } from "../../backend/src/shared/dashboardAccessRegistry";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function walkSqlFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...walkSqlFiles(fullPath));
    } else if (entry.endsWith(".sql")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("page access deployment contracts", () => {
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
  const navSource = read("src/components/layout/navConfig.tsx");
  const accessServiceSource = read("backend/src/modules/access/access.service.ts");
  const allSql = walkSqlFiles(resolve(process.cwd(), "backend/sql"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  const mountedRoutes = new Set(
    [...routeSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]),
  );

  const referencedPageCodes = Array.from(
    new Set([
      ...Object.values(PAGE_CODE_BY_ROUTE),
      ...Object.values(PAGE_CODE_BY_ROUTE_PATTERN),
      ...Object.values(DASHBOARD_ACCESS_REGISTRY).map((definition) => definition.pageCode),
      ...[...navSource.matchAll(/pageCode:\s*"([A-Z0-9_]+)"/g)].map((match) => match[1]),
    ]),
  ).sort();

  it("keeps every exact page route mapping mounted in the router", () => {
    const missingRoutes = Object.keys(PAGE_CODE_BY_ROUTE).filter((path) => !mountedRoutes.has(path));
    expect(missingRoutes).toEqual([]);
  });

  it("keeps every pattern page route mapping mounted in the router", () => {
    const missingPatterns = Object.keys(PAGE_CODE_BY_ROUTE_PATTERN).filter((path) => !mountedRoutes.has(path));
    expect(missingPatterns).toEqual([]);
  });

  it("keeps every referenced page code present in SQL migrations for page catalog or grants", () => {
    const missingPageCodes = referencedPageCodes.filter(
      (pageCode) => !allSql.includes(`'${pageCode}'`) && !allSql.includes(`"${pageCode}"`),
    );
    expect(missingPageCodes).toEqual([]);
  });

  it("keeps super admin elevated to every active page in access service", () => {
    expect(accessServiceSource).toContain("if (roles.includes(\"super_admin\"))");
    expect(accessServiceSource).toContain("for (const pageCode of activePageCodes)");
    expect(accessServiceSource).toContain("can_view: true");
    expect(accessServiceSource).toContain("can_create: true");
    expect(accessServiceSource).toContain("can_edit: true");
    expect(accessServiceSource).toContain("can_delete: true");
    expect(accessServiceSource).toContain("can_export: true");
  });

  it("keeps a blanket super_admin SQL grant for every active page_catalog row", () => {
    expect(allSql).toContain("SELECT UUID(), 'super_admin', pc.page_code, 1,1,1,1,1, 1, NOW()");
    expect(allSql).toContain("FROM page_catalog pc");
  });

  it("keeps super admin included on literal role-gated routes that are not page-mapped", () => {
    const routeMatches = [...routeSource.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)];
    const nonCompliant = routeMatches
      .map(([_, path, element]) => {
        if (path.includes(":")) return null;
        if (!element.includes("<ProtectedRoute")) return null;
        if (element.includes("dashboardCode=")) return null;
        if (PAGE_CODE_BY_ROUTE[path]) return null;

        const roleMatch = element.match(/roles=\{\[([^\]]+)\]\}/);
        if (!roleMatch) return null;
        if (roleMatch[1].includes("...")) return null;

        const roles = roleMatch[1]
          .split(",")
          .map((entry) => entry.replace(/["'\s]/g, ""))
          .filter(Boolean);

        if (roles.includes("super_admin")) return null;
        return { path, roles };
      })
      .filter(Boolean);

    expect(nonCompliant).toEqual([]);
  });
});
