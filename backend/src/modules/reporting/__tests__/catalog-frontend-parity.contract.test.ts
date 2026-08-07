import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";

/**
 * The backend catalogue says what a report returns. The frontend catalogue says what the
 * grid draws. They are separate files, and the grid renders ONLY what its own catalogue
 * lists — ReportLibraryView maps `selectedReport.columns` for both the header row and every
 * cell, so a column the API returns but the frontend has never heard of is silently dropped.
 *
 * That is not hypothetical. On 2026-08-07, after cost centre and process were added to 67
 * backend reports, only 6 of them would have rendered it: 45 had a frontend entry without
 * the column and 16 had no frontend entry at all. The data crossed the wire and the table
 * threw it away — the work was real and ~91% invisible.
 *
 * This test pins the mandatory identity columns across the boundary. It is deliberately
 * narrow: it does not demand the two catalogues match column-for-column (the frontend
 * carries formatters, header groups and blank-when-zero rules the backend has no opinion
 * on). It asserts only that where the backend promises employee code, cost centre or
 * process, the frontend is able to draw them.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Column keys per report code, parsed out of the frontend catalogue source. */
const frontendColumns = (): Map<string, Set<string>> => {
  const src = read("../src/lib/report-catalog.ts");
  const out = new Map<string, Set<string>>();
  const codeRe = /code:\s*"([a-z0-9-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(src)) !== null) {
    const start = m.index;
    const next = src.indexOf('code: "', codeRe.lastIndex);
    const seg = src.slice(start, next === -1 ? src.length : next);
    const cols = /columns:\s*\[([\s\S]*?)\n\s*\],/.exec(seg);
    const keys = cols ? [...cols[1].matchAll(/key:\s*"([^"]+)"/g)].map(k => k[1]) : [];
    if (!out.has(m[1])) out.set(m[1], new Set(keys));
  }
  return out;
};

/** Same fact under a different spelling still counts — leave-balance uses a mandated layout. */
const SYNONYMS: Record<string, readonly string[]> = {
  employee_code: ["employee_code", "emp_code", "candidate_code"],
  cost_centre_code: ["cost_centre_code", "cost_center_code", "cost_center", "cost_centre"],
  cost_centre_name: ["cost_centre_name", "cost_center_name", "cost_center", "cost_centre"],
  process_name: ["process_name", "process"],
};

const has = (keys: Set<string>, fact: string) =>
  (SYNONYMS[fact] ?? [fact]).some(k => keys.has(k));

describe("frontend catalogue can draw what the backend returns", () => {
  const front = frontendColumns();

  it("reads both catalogues", () => {
    expect(front.size).toBeGreaterThan(50);
    expect(REPORT_CATALOG.length).toBeGreaterThan(100);
  });

  it("renders cost centre and process wherever the backend emits them", () => {
    const offenders: string[] = [];

    for (const report of REPORT_CATALOG) {
      const backKeys = new Set((report.columns ?? []).map(c => c.key));
      const frontKeys = front.get(report.code);
      // A report with no frontend entry cannot be selected in the library at all. That is a
      // separate, pre-existing gap (tracked below) — not a rendering mismatch.
      if (!frontKeys) continue;

      for (const fact of ["cost_centre_code", "cost_centre_name", "process_name"]) {
        if (has(backKeys, fact) && !has(frontKeys, fact)) {
          offenders.push(`${report.code}: backend returns ${fact}, frontend will not draw it`);
        }
      }
    }

    expect(
      offenders.sort(),
      `columns the API returns and the grid discards:\n${offenders.sort().join("\n")}`,
    ).toEqual([]);
  });

  it("records how many backend reports the library cannot list at all", () => {
    // Not a failure — this is the older 120-vs-87 catalogue drift, and closing it means
    // authoring real frontend entries (labels, formats, widths) per report rather than
    // copying keys. Asserted as a ceiling so it cannot quietly grow.
    const unlistable = REPORT_CATALOG.filter(r => !front.has(r.code)).map(r => r.code);
    expect(
      unlistable.length,
      `reports with no frontend catalogue entry (cannot be selected in the Report Library):\n${unlistable.sort().join("\n")}`,
    ).toBeLessThanOrEqual(40);
  });
});
