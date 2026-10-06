import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nonVoidRunSql } from "../../payroll/run-status.js";

/**
 * A cancelled or rejected salary_prep_run is void: its lines are not people cost. The Aug-2026
 * cancelled stub run (3 lines) set payrollPosted=true on Live/CEO/Statement and replaced the whole
 * company's running-salary fallback with ~Rs 1.75 L. Every P&L statement that reads salary_prep_run
 * must therefore carry nonVoidRunSql() in the same statement.
 */
const dir = join(__dirname, "..");

function statementsReadingRuns(source: string): string[] {
  // The SQL template literal around each FROM/JOIN of the table (comments mention it freely).
  const out: string[] = [];
  for (const m of source.matchAll(/\b(?:FROM|JOIN)\s+salary_prep_run\b/g)) {
    const start = source.lastIndexOf("`", m.index);
    const end = source.indexOf("`", m.index);
    if (start >= 0 && end > 0) out.push(source.slice(start, end + 1));
  }
  return out;
}

describe("P&L ignores void payroll runs", () => {
  it("nonVoidRunSql excludes cancelled and rejected", () => {
    expect(nonVoidRunSql("r")).toBe("LOWER(TRIM(COALESCE(r.status, ''))) NOT IN ('cancelled','rejected')");
    expect(nonVoidRunSql()).toBe("LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelled','rejected')");
  });

  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const sqls = statementsReadingRuns(readFileSync(join(dir, file), "utf8"));
    if (!sqls.length) continue;
    it(`${file}: every salary_prep_run read filters void runs`, () => {
      for (const sql of sqls) expect(sql, sql.slice(0, 160)).toMatch(/\$\{nonVoidRunSql\(/);
    });
  }
});
