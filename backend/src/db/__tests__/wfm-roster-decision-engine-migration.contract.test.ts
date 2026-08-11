import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/223_wfm_roster_decision_engine.sql"), "utf8");

describe("WFM roster decision engine migration", () => {
  it("does not use MySQL-incompatible ADD COLUMN IF NOT EXISTS syntax", () => {
    expect(migration).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });

  it("adds existing-table columns through a guarded helper", () => {
    expect(migration).toMatch(/CREATE PROCEDURE _223_add_col/i);
    expect(migration).toMatch(/information_schema\.COLUMNS/i);
    expect(migration).toMatch(/CALL _223_add_col\('wfm_roster_assignment', 'generation_run_id'/i);
    expect(migration).toMatch(/CALL _223_add_col\('weekly_roster_cycle', 'required_ack_pct'/i);
    expect(migration).toMatch(/CALL _223_add_col\('roster_daily_assignment', 'dispute_reason'/i);
    expect(migration).toMatch(/DROP PROCEDURE IF EXISTS _223_add_col/i);
  });
});
