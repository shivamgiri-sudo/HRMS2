import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(
  new URL("../src/pages/dashboards/reference/ReferenceDashboardShell.tsx", import.meta.url),
  "utf8",
);
const shellCss = readFileSync(
  new URL("../src/pages/dashboards/reference/reference-dashboard-shell.css", import.meta.url),
  "utf8",
);
const compatibilityCss = readFileSync(
  new URL("../src/pages/dashboards/reference/reference-dashboard-shell-fixes.css", import.meta.url),
  "utf8",
);

describe("reference dashboard shell contract", () => {
  it("uses one unified sidebar component for every dashboard role", () => {
    expect(shellSource).toContain("reference-app-shell--unified");
    expect(shellSource).toContain("reference-shell-sidebar--unified");
    expect(shellSource).toContain("UnifiedSidebar");
    expect(shellSource).not.toContain("ProductSidebar");
    expect(shellSource).not.toContain("shellMode(");
  });

  it("defines desktop layout directly as a two-column grid", () => {
    expect(shellCss).toContain("grid-template-columns: 232px minmax(0, 1fr) !important");
    expect(shellCss).toContain("position: sticky !important");
    expect(shellCss).toContain("margin: 0 !important");
    expect(shellCss).toContain("max-width: 100vw");
  });

  it("does not retain fixed desktop sidebars or legacy shell variants", () => {
    expect(shellCss).not.toContain("reference-shell-sidebar--product");
    expect(shellCss).not.toContain("reference-app-shell--corporate");
    expect(shellCss).not.toContain("margin-left: 232px");
    expect(shellCss).not.toContain("margin-left: 176px");
    expect(shellCss).not.toMatch(/\.reference-shell-sidebar\s*\{[^}]*position:\s*fixed/s);
  });

  it("keeps the compatibility stylesheet free of layout overrides", () => {
    expect(compatibilityCss).not.toContain("grid-template-columns");
    expect(compatibilityCss).not.toContain("position: sticky");
    expect(compatibilityCss).not.toContain("margin-left");
  });

  it("keeps main and dashboard content inside the visible viewport", () => {
    expect(shellCss).toContain(".reference-shell-main");
    expect(shellCss).toContain(".reference-shell-content");
    expect(shellCss).toContain("min-width: 0");
    expect(shellCss).toContain("overflow-x: hidden");
  });
});
