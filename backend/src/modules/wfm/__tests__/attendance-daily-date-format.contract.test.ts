import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Three queries return `record_date` from `attendance_daily_record` to the frontend.
 * They must agree on its shape, because every calendar that reads them keys its day
 * cells on a strict YYYY-MM-DD.
 *
 * Two of the three already DATE_FORMAT it. wfm.routes.ts's `/attendance/daily` — the
 * one that wins the route collision whenever `employeeId` is present, and therefore the
 * one those calendars actually hit — returned it raw. That is a bare "2026-08-01" only
 * because the pool sets `dateStrings: true` (backend/src/db/mysql.ts). Flip that flag,
 * run against a pool without it, or put any serializer in between, and `record_date`
 * becomes "2026-07-31T18:30:00.000Z": every map lookup misses, the whole month renders
 * blank, and the tabular view keeps working because it slices to 10 characters. A
 * calendar silently empty next to a populated table is exactly the bug this module
 * spent two rounds fixing, so the shape is pinned here rather than left to a pool flag.
 */
const WFM_DIR = path.resolve(__dirname, "..");

function read(file: string): string {
  return fs.readFileSync(path.join(WFM_DIR, file), "utf8");
}

/** The `SELECT ... FROM attendance_daily_record` blocks in a file. */
function adrSelects(source: string): string[] {
  return [...source.matchAll(/SELECT[\s\S]{0,2000}?FROM\s+attendance_daily_record/gi)].map(
    (m) => m[0],
  );
}

describe("record_date is returned in a canonical YYYY-MM-DD shape", () => {
  it("wfm.routes.ts /attendance/daily formats record_date", () => {
    const sql = read("wfm.routes.ts");
    expect(sql).toContain("DATE_FORMAT(record_date, '%Y-%m-%d') AS date");
    expect(sql).toContain("DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date");
  });

  it("no query selects a bare record_date column for a client response", () => {
    // Catches a re-introduction in either file, including by a whole-file revert.
    for (const file of ["wfm.routes.ts", "attendance-daily-scoped.routes.ts"]) {
      for (const block of adrSelects(read(file))) {
        const bare = block
          .split("\n")
          .map((l) => l.trim().replace(/,$/, ""))
          .filter((l) => l === "record_date");

        expect(
          bare,
          `${file} selects a bare \`record_date\`. Wrap it in ` +
            `DATE_FORMAT(record_date, '%Y-%m-%d') so the day-cell lookup cannot ` +
            `depend on the pool's dateStrings flag.`,
        ).toEqual([]);
      }
    }
  });

  it("the sibling query it was drifting from still formats its own", () => {
    // If this ever fails the two have simply swapped roles — fix both, do not delete.
    expect(read("attendance-daily-scoped.routes.ts")).toMatch(
      /DATE_FORMAT\(\s*adr\.record_date\s*,\s*'%Y-%m-%d'\s*\)/,
    );
  });
});
