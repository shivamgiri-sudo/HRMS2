import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * `salary_prep_run.run_month` is VARCHAR(7) holding 'YYYY-MM' — it is NOT a DATE.
 *
 * The payroll-projection endpoint filtered it with
 *   WHERE sp.run_month >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)
 * which made MySQL coerce every 'YYYY-MM' string to a date. Every row failed with
 * "Truncated incorrect date value: '2026-07'" and the predicate matched 0 of 66 runs, so the
 * endpoint returned total_projected: 0 and thirty days of projected_cost: 0 to every caller.
 * It threw nothing, so it read as "payroll projection is zero", not as a broken query.
 *
 * Two shapes are wrong on this column and both are checked:
 *   - comparing it to a DATE-returning function (CURDATE/NOW/DATE_SUB/DATE_ADD)
 *   - wrapping it in DATE_FORMAT(), which returns NULL for a non-date string
 * The correct form renders the *cutoff* as 'YYYY-MM' and compares lexicographically, which is
 * sound for zero-padded year-month.
 */
function sqlFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      out.push(...sqlFilesUnder(join(dir, entry.name)));
    } else if (entry.name.endsWith(".ts")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const TS_FILES = sqlFilesUnder(SRC_DIR);

/**
 * Strip block and line comments. The fix for this bug documents the broken SQL verbatim in a
 * comment, and a scanner that counted prose would flag the very file that fixes it.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** run_month compared against a DATE-producing function. */
export function dateComparisons(raw: string): string[] {
  const src = codeOnly(raw);
  return [
    ...src.matchAll(
      /run_month\s*(?:>=|<=|>|<|=)\s*(?:DATE_SUB|DATE_ADD|CURDATE|NOW|CURRENT_DATE)\s*\(/gi
    ),
  ].map((m) => m[0].replace(/\s+/g, " "));
}

/** run_month wrapped in DATE_FORMAT — returns NULL for a varchar 'YYYY-MM'. */
export function dateFormatWraps(raw: string): string[] {
  return [...codeOnly(raw).matchAll(/DATE_FORMAT\(\s*[A-Za-z_]*\.?run_month\b/gi)].map((m) =>
    m[0].replace(/\s+/g, " ")
  );
}

describe("salary_prep_run.run_month is VARCHAR, not DATE", () => {
  it("flags a comparison against a DATE function", () => {
    expect(
      dateComparisons("WHERE sp.run_month >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)")
    ).toHaveLength(1);
  });

  it("flags DATE_FORMAT applied to the column", () => {
    expect(dateFormatWraps("SELECT DATE_FORMAT(sp.run_month, '%Y-%m')")).toHaveLength(1);
  });

  it("accepts the correct form — cutoff rendered as 'YYYY-MM', compared as a string", () => {
    const good =
      "WHERE sp.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 MONTH), '%Y-%m')";
    expect(dateComparisons(good)).toEqual([]);
    expect(dateFormatWraps(good)).toEqual([]);
  });

  it("no backend source compares run_month against a DATE function", () => {
    const offenders: string[] = [];
    for (const f of TS_FILES) {
      const hits = dateComparisons(readFileSync(f, "utf8"));
      if (hits.length) offenders.push(`${f}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no backend source wraps run_month in DATE_FORMAT", () => {
    const offenders: string[] = [];
    for (const f of TS_FILES) {
      const hits = dateFormatWraps(readFileSync(f, "utf8"));
      if (hits.length) offenders.push(`${f}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
