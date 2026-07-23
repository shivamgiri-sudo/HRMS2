import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("shared shell and dashboard runtime contracts", () => {
  it("preserves the sidebar scroll position across route remounts", () => {
    const sidebarSource = read("src/components/layout/SidebarNav.tsx");
    const scrollSource = read("src/components/layout/ScrollToTop.tsx");

    expect(sidebarSource).toContain("SIDEBAR_SCROLL_STORAGE_KEY");
    expect(sidebarSource).toContain("useLayoutEffect");
    expect(sidebarSource).toContain("sessionStorage.setItem");
    expect(scrollSource).not.toContain(".mcn-sidebar-scroll");
  });

  it("reads Company Feed API bodies directly from hrmsApi", () => {
    const hookSource = read("src/hooks/useCompanyFeed.ts");

    expect(hookSource).not.toContain("const body = res.data");
    expect(hookSource).toContain("const body = res;");

    const feedPageSource = read("src/pages/NativeCompanyFeed.tsx");
    expect(feedPageSource).toContain('to="/engagement/company-feed/create"');
    expect(feedPageSource).not.toContain('to="/company-feed/create"');
    expect(feedPageSource).toContain("forbidden|http 403");
  });

  it("normalizes Operations API contracts before rendering numeric values", () => {
    const source = read("src/pages/NativeOperationsDashboard.tsx");

    expect(source).toContain("normalizeCoverageData");
    expect(source).toContain("normalizeKpiEntries");
    expect(source).toContain("normalizeAttritionSummary");
    expect(source).toContain('type="month"');
    expect(source).not.toContain("period=${period}");
  });

  it("declares the Quality numeric helper before any dashboard JSX uses it", () => {
    const source = read("src/pages/NativeQualityDashboard.tsx");
    const helperIndex = source.indexOf("function safeNumber");
    const overviewIndex = source.indexOf("const OverviewTab");

    expect(helperIndex).toBeGreaterThanOrEqual(0);
    expect(helperIndex).toBeLessThan(overviewIndex);
    expect(source).not.toContain("const n = (v: unknown)");
    expect(source).not.toContain("/api/quality-dashboard/client-drill/");
    expect(source).toContain("clientsQ.data");
  });

  it("keeps an explicit Copilot entry point visible on authenticated pages", () => {
    const commandBarSource = read("src/components/ai/AICommandBar.tsx");
    const stripSource = read("src/components/ai/AmbientStrip.tsx");

    expect(commandBarSource).toContain("<AmbientStrip");
    expect(commandBarSource).not.toContain("{showStrip &&");
    expect(stripSource).toContain("PeopleOS Copilot");
  });
});
