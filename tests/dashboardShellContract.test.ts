import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(
  new URL("../src/pages/dashboards/reference/ReferenceDashboardShell.tsx", import.meta.url),
  "utf8",
);
const shellFixes = readFileSync(
  new URL("../src/pages/dashboards/reference/reference-dashboard-shell-fixes.css", import.meta.url),
  "utf8",
);

describe("reference dashboard shell contract", () => {
  it("uses one unified shell for every dashboard role", () => {
    expect(shellSource).toContain("reference-app-shell--unified");
    expect(shellSource).toContain("reference-shell-sidebar--unified");
    expect(shellSource).toContain("UnifiedSidebar");
    expect(shellSource).not.toContain("ProductSidebar");
    expect(shellSource).not.toContain("shellMode(");
  });

  it("uses a desktop grid instead of a fixed sidebar plus margin offset", () => {
    expect(shellFixes).toContain("grid-template-columns: 232px minmax(0, 1fr)");
    expect(shellFixes).toContain("position: sticky");
    expect(shellFixes).toContain("margin-left: 0 !important");
    expect(shellFixes).toContain("max-width: 100vw");
  });

  it("keeps main and dashboard content inside the visible viewport", () => {
    expect(shellFixes).toContain(".reference-app-shell--unified .reference-shell-main");
    expect(shellFixes).toContain(".reference-app-shell--unified .reference-shell-content");
    expect(shellFixes).toContain("min-width: 0");
    expect(shellFixes).toContain("overflow-x: hidden");
  });
});
