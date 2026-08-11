import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../../sql/138_ats_complete_journey.sql"), "utf8");

describe("ATS complete journey migration", () => {
  it("does not use MySQL-incompatible IF NOT EXISTS syntax for alters or indexes", () => {
    expect(migration).not.toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
    expect(migration).not.toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    expect(migration).toMatch(/ALTER TABLE ats_notification_log ADD COLUMN notification_type/i);
    expect(migration).toMatch(/ALTER TABLE ats_candidate ADD INDEX idx_ats_candidate_branch/i);
  });
});
