import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/pages/finance/ProcessPnlPage.tsx"), "utf8");

describe("Process P&L page matrix contracts", () => {
  it("exposes the alerts and reconciliation tab", () => {
    expect(pageSource).toContain('TabsTrigger value="alerts">Alerts &amp; Reconciliation</TabsTrigger>');
  });

  it("owns the matrix filter state", () => {
    expect(pageSource).toContain("const [matrixPreset, setMatrixPreset]");
    expect(pageSource).toContain("const [statusFilter, setStatusFilter]");
    expect(pageSource).toContain("const [issueFilter, setIssueFilter]");
  });

  it("renders the matrix toolbar with a summary default", () => {
    expect(pageSource).toContain("<ProcessPnlMatrixToolbar");
    expect(pageSource).toContain('useState<ProcessPnlMatrixPreset>("summary")');
  });
});
