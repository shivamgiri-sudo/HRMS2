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
 * The GRN module is deliberately out of scope: it has its own design system (GrnInput,
 * grn-scope, IBM Plex) and dropping a component styled for the default theme into it would
 * clash. Its inputs still accept a typed YYYY-MM, so nothing is unusable there.
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
    const offenders = tsxFiles(resolve(root, "pages/finance"))
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
