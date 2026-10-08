import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MOUNTED_ROUTE_PATHS } from "@/lib/mountedRoutePaths";

/**
 * Every route a Manager / Operations / Quality dashboard links to must be a really mounted page.
 * These dashboards emit links from backend providers (actions, KPIs, table rows) and from the layouts; a dead link
 * on a "pending approval" row is the worst failure this surface can have, so both are scanned for route literals.
 */
const ROOT = process.cwd();
const files = [
  "backend/src/modules/dashboards/role-insights/providers/manager.ts",
  "backend/src/modules/dashboards/role-insights/providers/operations.ts",
  "backend/src/modules/dashboards/role-insights/providers/operationsCalc.ts",
  "backend/src/modules/dashboards/role-insights/providers/quality.ts",
  "src/pages/dashboards/reference/ManagerReferenceLayout.tsx",
  "src/pages/dashboards/reference/OperationsReferenceLayout.tsx",
  "src/pages/dashboards/reference/QualityReferenceLayout.tsx",
  "src/pages/dashboards/reference/gap/GapNotes.tsx",
  ...["manager", "operations", "quality"].flatMap((d) =>
    readdirSync(resolve(ROOT, "src/pages/dashboards/reference", d)).filter((f) => /\.tsx?$/.test(f)).map((f) => `src/pages/dashboards/reference/${d}/${f}`)),
];

const LITERAL = /["'`](\/[a-z][a-z0-9\-/]*)(?:\?[^"'`]*)?["'`]/g;
/** Parameterised or non-page prefixes that are not entries in the static mounted-route set. */
const DYNAMIC_OK = ["/dashboards/drill/", "/api/"];

describe("manager / operations / quality dashboard links", () => {
  it("every static route literal is a mounted page", () => {
    const dead: string[] = [];
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), "utf8");
      for (const m of src.matchAll(LITERAL)) {
        const path = m[1].replace(/\/$/, "") || "/";
        if (DYNAMIC_OK.some((p) => path.startsWith(p))) continue;
        // `/dashboards/drill/${...}` style template literals are matched up to the interpolation; skip the prefix itself.
        if (path === "/dashboards" || path === "/dashboards/drill") continue;
        if (!MOUNTED_ROUTE_PATHS.has(path)) dead.push(`${f}: ${m[0]}`);
      }
    }
    expect(dead, `Links to routes that are not mounted:\n  ${dead.join("\n  ")}`).toEqual([]);
  });

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(15);
  });
});
