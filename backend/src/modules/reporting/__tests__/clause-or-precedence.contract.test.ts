import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const R = "src/modules/reporting";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * A clause pushed into a WHERE array must not contain a bare OR.
 *
 * These arrays are joined with " AND ", and AND binds tighter than OR, so an unparenthesised OR
 * silently re-associates the entire WHERE clause. left-employee-export pushed
 *
 *   "e.active_status = 0 OR e.employment_status IN ('resigned','inactive','Resigned','Exit')"
 *
 * which composed to
 *
 *   (scope AND active_status = 0) OR (employment_status IN (...) AND date BETWEEN ? AND ?)
 *
 * — a left branch with no date filter and a right branch with no row scope. Measured on live
 * 2026-08-09: super_admin got 57,501 rows where 1,574 was correct, and a branch-scoped user got
 * 1,338 rows of which every one belonged to a different branch. A 36x inflation and a complete
 * scope bypass from a missing pair of parentheses.
 *
 * It cannot be caught by reading the clause, which is correct in isolation. It only exists once
 * the array is joined — so the check has to be on the push site.
 */

const files = [
  `${R}/report-suite.routes.ts`,
  `${R}/report-suite-highrisk.routes.ts`,
  ...readdirSync(resolve(ROOT, `${R}/executors`))
    .filter(f => f.endsWith(".executor.ts"))
    .map(f => `${R}/executors/${f}`),
];

/** True when the whole expression sits inside ONE balanced pair of parentheses. */
function fullyWrapped(expr: string): boolean {
  const s = expr.trim();
  if (!s.startsWith("(") || !s.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return depth === 0;
}

/** Strip every parenthesised group, innermost first, so only top-level operators remain. */
function topLevel(expr: string): string {
  let prev: string | null = null;
  let s = expr;
  while (s !== prev) { prev = s; s = s.replace(/\([^()]*\)/g, " "); }
  return s;
}

describe("WHERE clause OR precedence", () => {
  it("no pushed clause contains an OR outside parentheses", () => {
    const offenders: string[] = [];
    for (const path of files) {
      read(path).split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        for (const m of line.matchAll(/clauses\.push\(\s*(["'`])([\s\S]*?)\1/g)) {
          const expr = m[2];
          if (!/\bOR\b/i.test(expr)) continue;
          if (fullyWrapped(expr)) continue;
          if (!/\bOR\b/i.test(topLevel(expr))) continue;
          offenders.push(`${path.split("/").pop()}:${i + 1}  ${expr.slice(0, 100)}`);
        }
      });
    }
    expect(
      offenders,
      "these join into the WHERE with AND, which binds tighter than OR, so the clause will " +
        "re-associate and take the row scope or the date filter with it. Wrap the whole " +
        "expression in parentheses:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("left-employee-export keeps its parentheses, wherever the clause lives", () => {
    // The specific regression: this one cost a 36x row inflation and a scope bypass.
    //
    // Searched across every candidate file rather than pinned to one, because the clause has
    // already moved once — from the inline case block into employee.executor.ts when the report
    // was promoted so its download would work. A guard that names the file would have failed on
    // that move and taught the next person to delete it; a guard that follows the clause keeps
    // testing the thing that matters.
    const wanted = "(e.active_status = 0 OR e.employment_status IN ('resigned','inactive','Resigned','Exit'))";
    const homes = files.filter(p => read(p).includes(wanted));
    expect(
      homes.length,
      "the leaver predicate must exist, parenthesised, in exactly one place. Found in: " +
        (homes.join(", ") || "nowhere — check whether it was unwrapped or renamed"),
    ).toBe(1);
  });
});
