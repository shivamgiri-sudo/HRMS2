import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNTED_ROUTE_PATHS } from "../mountedRoutePaths";

const routeDir = resolve(process.cwd(), "src/config/routes");

function mountedFromRouteFiles(): Set<string> {
  const paths = new Set<string>();
  for (const file of readdirSync(routeDir).filter((name) => name.endsWith(".tsx"))) {
    const source = readFileSync(resolve(routeDir, file), "utf8");
    for (const match of source.matchAll(/<Route\s+path=["']([^"']+)["']/g)) {
      if (!match[1].includes(":") && !match[1].includes("*")) paths.add(match[1]);
    }
  }
  return paths;
}

describe("MOUNTED_ROUTE_PATHS", () => {
  it("lists every static route the route files mount, so the module launcher can trust catalog paths", () => {
    const actual = mountedFromRouteFiles();
    const missing = [...actual].filter((p) => !MOUNTED_ROUTE_PATHS.has(p));
    const stale = [...MOUNTED_ROUTE_PATHS].filter((p) => !actual.has(p));
    expect({ missing, stale }, "regenerate src/lib/mountedRoutePaths.ts from the route files").toEqual({ missing: [], stale: [] });
  });
});
