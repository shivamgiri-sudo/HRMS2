import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * No finance page may use a native `<input type="month">`.
 *
 * Safari has never implemented it: the control degrades to a plain text box with no picker at
 * all, which reads as "the month dropdown is broken" rather than as a browser gap. The Branch
 * Budget workspace already shipped a two-`<select>` MonthYearPicker with a comment explaining
 * exactly this — and was the only one of five finance pages that used it, so it was the only one
 * a Safari user could pick a period on. The component is now shared.
 *
 * The GRN module is included too. It has its own design system (GrnInput, grn-scope, IBM Plex),
 * so rather than importing a control styled for the default theme it passes its own tokens
 * through selectClassName — the picker works everywhere without the surface looking borrowed.
 */

const root = resolve(process.cwd(), "src");

/**
 * Source with comments removed.
 *
 * These files DOCUMENT the native input they exist to replace, so a plain text search finds the
 * literal in prose and reports a correct file as an offender — which is exactly what happened
 * while writing this test. Only real JSX should count.
 */
const read = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return tsxFiles(full);
    return e.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("finance period pickers work in every browser", () => {
  it("no finance page uses the native month input", () => {
    const offenders = [...tsxFiles(resolve(root, "pages/finance")), ...tsxFiles(resolve(root, "components/finance"))]
      .filter((f) => !f.endsWith("MonthYearPicker.tsx"))
      .filter((f) => /<\w+[^>]*\stype="month"/.test(read(f)))
      .map((f) => f.replace(root, "src"));
    expect(offenders, "use MonthYearPicker — Safari renders type=month as a bare text box").toEqual([]);
  });

  it("the shared picker exists and is a pair of selects, not an input", () => {
    const source = read(resolve(root, "components/finance/MonthYearPicker.tsx"));
    expect(source).toContain('aria-label="Month"');
    expect(source).toContain('aria-label="Year"');
    expect(source).not.toMatch(/<\w+[^>]*\stype="month"/);
  });

  it("the workspace no longer keeps a private copy", () => {
    // Two implementations of the same control drift; the workspace's was the original.
    const workspace = read(resolve(root, "pages/finance/BranchBudgetManagementWorkspace.tsx"));
    expect(workspace).toContain('from "@/components/finance/MonthYearPicker"');
    expect(workspace).not.toContain("function MonthYearPicker");
  });
});

/**
 * Three P&L surfaces that told the reader nothing, or the wrong thing.
 */
describe("Process P&L surfaces explain themselves", () => {
  const page = (f: string) => read(resolve(root, "pages/finance", f));

  it("Period Close says why Lock is unavailable", () => {
    // canonicalCloseView returns qualityGates alongside canLock; the hook never declared them,
    // so the button just vanished and the page gave no reason.
    expect(read(resolve(root, "hooks/usePnlReconciliation.ts"))).toContain("qualityGates?: {");
    const close = page("PnlPeriodClosePage.tsx");
    expect(close).toContain("closeData?.qualityGates?.blockerCount");
    expect(close).toContain("Cannot lock —");
  });

  it("the P&L filters do not narrow themselves out of reach", () => {
    // rows are the response for the CURRENT filters, so deriving options from them left
    // ["All branches", "Mumbai"] after picking Mumbai — and escaping cost two 16-23s queries.
    const list = page("ProcessPnlPage.tsx");
    expect(list).toContain("seenBranches");
    expect(list).toContain("seenClients");
    expect(list).not.toMatch(/const branches = Array\.from\(\s*new Map\(rows/);
  });

  it("both P&L pages open on the same month", () => {
    // The list page opens on the previous month and documents why: the current month has
    // invoicing but no payroll run, which reads as broken arithmetic. The detail page defaulted
    // to the current month, so a bookmarked link disagreed with the page it came from.
    for (const f of ["ProcessPnlPage.tsx", "ProcessPnlDetailPage.tsx"]) {
      expect(page(f), `${f} must default to the previous month`)
        .toContain("now.getMonth() - 1");
    }
  });
});

describe("the P&L ledger Note column carries something", () => {
  const service = readFileSync(
    resolve(process.cwd(), "backend/src/modules/process-pnl/process-pnl.service.ts"), "utf8");

  it("populates notes for the cost rows that dominate the ledger", () => {
    // Only `adjustment` supplied a note, so the column rendered "-" on nearly every row. A GRN
    // carries the raiser's own description of what was bought, which is what a reader scanning
    // a cost ledger actually wants.
    expect(service).toContain("NULLIF(TRIM(COALESCE(g.description, '')), '') AS note");
    expect(service).toContain("NULLIF(TRIM(COALESCE(grn.description, '')), '') AS note");
    const notes = service.match(/note: row\.note \?\? null/g) ?? [];
    expect(notes.length, "grn_cost and vendor_cost both").toBe(2);
  });

  it("the synthesised allocation row explains itself", () => {
    expect(service).toContain('note: "Branch indirect cost apportioned to this process"');
  });
});
