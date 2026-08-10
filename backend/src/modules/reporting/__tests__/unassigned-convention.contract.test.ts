import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const R = "src/modules/reporting";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * An employee with no branch, department, process or cost centre still appears in every report,
 * and the gap is NAMED — 'UNASSIGNED', never NULL. Ruling of 2026-08-07, alongside the decision
 * that such rows are never dropped.
 *
 * The two halves matter equally. Dropping the row hides a real employee; rendering NULL puts
 * them on screen as an empty cell, which reads as "nothing loaded" or as a rendering fault
 * rather than as a fact about that employee. 64 active employees have no cost centre and 143 no
 * process — those are findings, and a blank cell buries them.
 *
 * Measured before the fix: 8 of 95 headcount rows, 4 of 41 cost-centre-headcount rows, and
 * 52 of 300 sampled employee-movement rows rendered NULL in a governed column.
 *
 * This checks the SQL rather than the API so it runs without a database, which means it reads
 * the text of the SELECT list. Only bare `alias.column` selects are caught; a report that
 * derives its branch some other way needs its own check.
 */

/** column -> the alias.column form that must not be selected bare. */
const GOVERNED: Array<[string, RegExp]> = [
  ["branch_name", /^\s*b\.branch_name\s*,?\s*$/],
  ["department_name", /^\s*d\.dept_name\s+AS\s+department_name\s*,?\s*$/i],
  ["process_name", /^\s*p\.process_name\s*,?\s*$/],
  ["cost_centre_code", /^\s*cc\.cost_centre_code\s*,?\s*$/],
  ["cost_centre_name", /^\s*cc\.cost_centre_name\s*,?\s*$/],
];

const files = [
  `${R}/report-suite.routes.ts`,
  `${R}/report-suite-highrisk.routes.ts`,
  ...readdirSync(resolve(ROOT, `${R}/executors`))
    .filter(f => f.endsWith(".executor.ts"))
    .map(f => `${R}/executors/${f}`),
];

describe("UNASSIGNED convention", () => {
  /**
   * True when the nearest preceding SQL keyword is SELECT — i.e. the line is part of a select
   * list rather than a GROUP BY / ORDER BY continuation.
   *
   * This distinction is the whole point. `b.branch_name, p.process_name` appears in both, and
   * COALESCEing it inside a GROUP BY would change what is counted rather than what is shown.
   * Two lines in leave.executor.ts are exactly that and must stay bare.
   *
   * Comment lines are skipped while scanning back: a `-- ... lives on exit_request` comment
   * contains the word "on", which a naive keyword scan reads as a JOIN condition and which hid
   * a real offender in exit.executor.ts.
   */
  const inSelectList = (lines: string[], i: number): boolean => {
    const CLAUSE = /\b(SELECT|FROM|GROUP\s+BY|ORDER\s+BY|WHERE|HAVING|JOIN|ON)\b/gi;
    for (let j = i - 1; j >= 0 && j > i - 60; j--) {
      if (/^\s*(\/\/|\*|--)/.test(lines[j])) continue;
      const found = [...lines[j].matchAll(CLAUSE)];
      if (found.length) return found[found.length - 1][1].toUpperCase().startsWith("SELECT");
    }
    return false;
  };

  it("no report selects a governed column bare, where NULL would reach the grid", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const lines = read(path).split("\n");
      lines.forEach((line, i) => {
        // Comments describe the old shape in several places; they are not SELECT lists.
        if (/^\s*(\/\/|\*|--)/.test(line)) return;
        if (!inSelectList(lines, i)) return;
        for (const [col, re] of GOVERNED) {
          // A line combining two bare columns, e.g. `b.branch_name, p.process_name,`
          const combined = /^\s*b\.branch_name\s*,\s*p\.process_name\s*,?\s*$/.test(line)
            || /^\s*b\.branch_name\s*,\s*d\.dept_name\s+AS\s+department_name\s*,?\s*$/i.test(line);
          if (re.test(line) || combined) {
            offenders.push(`${path.split("/").pop()}:${i + 1}  ${col}  ${line.trim()}`);
            break;
          }
        }
      });
    }
    expect(
      offenders,
      "these select a governed column bare, so an unmapped employee renders as an empty cell " +
        "instead of UNASSIGNED:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("COALESCE is applied in the SELECT, not in the GROUP BY", () => {
    // Grouping on COALESCE(...) would merge unmapped rows with any real entity literally named
    // UNASSIGNED, and — more importantly — changes what is counted. The convention is about
    // labelling, and a headcount must not move because of it. All three headcount reports
    // reconcile to 1,125 before and after.
    const offenders: string[] = [];
    for (const path of files) {
      read(path).split("\n").forEach((line, i) => {
        if (/GROUP\s+BY/i.test(line) && /COALESCE\s*\(\s*(b\.branch_name|d\.dept_name|p\.process_name|cc\.cost_centre)/i.test(line)) {
          offenders.push(`${path.split("/").pop()}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "grouping on the COALESCEd expression changes what is counted, not just what is shown:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
