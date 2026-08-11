import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/227_week_off_preference_schema_fix.sql"), "utf8");

describe("week off preference schema fix migration", () => {
  it("does not use MySQL-incompatible executable alter syntax", () => {
    expect(migration).not.toMatch(/^\s*ADD COLUMN IF NOT EXISTS/im);
    expect(migration).not.toMatch(/^\s*ADD INDEX IF NOT EXISTS/im);
  });

  it("guards columns and indexes with information_schema", () => {
    expect(migration).toMatch(/CREATE PROCEDURE _227_add_col/i);
    expect(migration).toMatch(/information_schema\.COLUMNS/i);
    expect(migration).toMatch(/CALL _227_add_col\('week_start_date'/i);
    expect(migration).toMatch(/information_schema\.statistics/i);
    expect(migration).toMatch(/idx_wop_process_week/i);
    expect(migration).toMatch(/idx_wop_status/i);
  });
});
