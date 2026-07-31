import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * The KPI target grid exists because targets could previously only be set one process per
 * visit (/kpi-config) or one row at a time across a flat list of 372 (/kpi-master), and
 * neither could express a process and designation together at all.
 */
describe("KPI target matrix", () => {
  const page = read("src/pages/KpiTargetMatrix.tsx");
  const routes = read("src/config/routes/performance.routes.tsx");
  const nav = read("src/components/layout/navConfig.tsx");

  it("is mounted and gated like the config page it sits beside", () => {
    expect(routes).toContain('path="/kpi-targets"');
    expect(routes).toContain("<KpiTargetMatrix />");
    // UI gating is not security, but an ungated route here would be the only one in the
    // performance group without a pageCode.
    const routeIndex = routes.indexOf('path="/kpi-targets"');
    expect(routes.slice(routeIndex, routeIndex + 240)).toContain('pageCode="KPI_MASTER"');
    expect(routes.slice(routeIndex, routeIndex + 240)).toContain("<ProtectedRoute>");
  });

  it("is reachable from the sidebar", () => {
    expect(nav).toContain('href: "/kpi-targets"');
    expect(nav).toContain('label: "KPI Targets"');
  });

  it("reads the matrix endpoint and saves through the bulk endpoint", () => {
    expect(page).toContain("/api/kpi-master/matrix");
    expect(page).toContain("/api/kpi-master/matrix/bulk");
  });

  it("distinguishes an inherited target from one set for the exact pair", () => {
    // Showing an inherited number as though somebody chose it is the specific confusion
    // this screen exists to remove.
    expect(page).toContain("SOURCE_LABEL");
    for (const source of ["explicit", "process", "cost_centre", "designation", "department", "none"]) {
      expect(page).toContain(`${source}:`);
    }
    expect(page).toContain('cell.source !== "explicit"');
  });

  it("surfaces pairs whose inherited value does not apply to everyone in the row", () => {
    expect(page).toContain("inherit_varies");
  });

  it("does not offer a target for a metric the process never reports", () => {
    // Metric sets differ sharply per process — one reports thirteen metrics, another
    // reports attendance alone. An editable box in an irrelevant column invites a target
    // that nothing will ever score against.
    expect(page).toContain("cell.applicable");
    expect(page).toContain("n/a");
    expect(page).toContain("showAllMetrics");
  });

  it("stops a bulk apply from spreading a target onto processes that do not report it", () => {
    const bulk = page.slice(page.indexOf("function applyBulk"), page.indexOf("const pendingCount"));
    expect(bulk).toContain("applicable === false");
    expect(bulk).toContain("skipped");
  });

  it("shows each metric's unit and direction so a bare number is unambiguous", () => {
    // 240 seconds is a ceiling to stay under; 95 percent is a floor to reach. Without the
    // unit and direction on the column the two are indistinguishable.
    expect(page).toContain("UNIT_SYMBOL");
    expect(page).toContain("lower better");
    expect(page).toContain("higher better");
  });

  it("keeps a wide grid scrolling inside its own container", () => {
    // The page body must never scroll sideways, however many metric columns appear.
    expect(page).toContain("overflow-x-auto");
  });

  it("uses semantic table structure rather than a div grid", () => {
    expect(page).toContain("<TableHeader>");
    expect(page).toContain("<TableBody>");
    expect(page).toContain("<TableHead");
    expect(page).not.toMatch(/<div className="grid grid-cols-\d+[^"]*">\s*<div>Process</);
  });

  it("points the two older configuration screens at the grid without removing them", () => {
    // CLAUDE.md forbids deleting existing page flows; both stay mounted.
    expect(routes).toContain('path="/kpi-master"');
    expect(routes).toContain('path="/kpi-config"');
    expect(read("src/pages/KpiMasterConfig.tsx")).toContain('href="/kpi-targets"');
    expect(read("src/pages/NativeKPIConfiguration.tsx")).toContain('href="/kpi-targets"');
  });
});
