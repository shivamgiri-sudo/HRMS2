import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/pages/finance/ProcessPnlPage.tsx"), "utf8");
const matrixSource = readFileSync(
  resolve(process.cwd(), "src/components/finance/pnl/BpoPnlMatrixTable.tsx"),
  "utf8",
);

describe("Process P&L page matrix contracts", () => {
  it("exposes the alerts and reconciliation tab", () => {
    expect(pageSource).toContain('TabsTrigger value="alerts">Alerts &amp; Reconciliation</TabsTrigger>');
  });

  it("mounts the focused alerts workspace instead of the retired charts tab", () => {
    expect(pageSource).toContain("<ProcessPnlAlertsWorkspace");
    expect(pageSource).not.toContain('TabsContent value="charts"');
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

  it("renders config-driven totals and sortable matrix headers", () => {
    expect(matrixSource).toContain("<ProcessPnlMatrixTotals");
    expect(matrixSource).toContain("onClick={() => handleSort(column.key)}");
    expect(matrixSource).toContain('preset === "full"');
  });

  it("supports opening a process snapshot from the matrix", () => {
    expect(matrixSource).toContain("setSelectedRow(row)");
    expect(matrixSource).toContain("<ProcessPnlRowDrawer");
    expect(matrixSource).toContain('title="Open process snapshot"');
  });
});
