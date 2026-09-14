import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * CEO UAT Round 2 regression: /operations-kpi reported "Employees Scored 0" for every
 * period, having shown 205 in Round 1.
 *
 * No data was lost — 22,833 kpi_daily_actual rows and 963 scoreable employees remained for
 * 2026-07. Round 1's 205 was itself a symptom: the UI sent `process_id`, the zod schema
 * declared `processId`, the unknown key was stripped, and every request went org-wide
 * regardless of the dropdown.
 *
 * Fixing the binding made the page's mount-time auto-select live, so it began requesting
 * one arbitrary process. Processes with no kpi_process_config targets return nothing.
 */
describe("operations KPI default scope", () => {
  const page = read("src/pages/NativeOperationsKPI.tsx");

  /** The page body with comments stripped — a negative assertion must not match prose. */
  const code = page
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("does not auto-select a process on mount", () => {
    // The single line that caused the regression.
    expect(code).not.toContain("setSelectedProcess(list[0].id)");
    expect(code).not.toMatch(/setSelectedProcess\(\s*list\[0\]/);
  });

  it("keeps loadProcesses independent of the current selection", () => {
    // `}, [selectedProcess])` re-ran the loader whenever the selection changed, which is
    // what made the auto-select able to reassert itself.
    const loader = code.slice(code.indexOf("const loadProcesses"), code.indexOf("const loadData"));
    expect(loader).toContain("}, []);");
    expect(loader).not.toContain("}, [selectedProcess]);");
  });

  it("still offers an explicit All Processes option", () => {
    // Removing the auto-select is only correct if the empty selection is reachable and
    // means org-wide.
    expect(page).toMatch(/All Processes/);
  });

  it("counts a missing target separately from a genuine zero", () => {
    // weighted_score_pct is SUM(...)/NULLIF(SUM(weightage),0) — NULL means the process has
    // no configured target, which is a configuration gap, not a performance result.
    expect(code).toContain("e.weighted_score_pct != null && e.weighted_score_pct > 0");
    expect(code).toContain("untargetedCount");
    expect(code).not.toContain("(e.weighted_score_pct ?? 0) > 0");
  });

  it("tells the user which of the two an empty page is", () => {
    expect(code).toContain("without a configured target");
  });
});
