import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../../sql/138_ats_complete_journey.sql"), "utf8");

describe("ATS complete journey migration", () => {
  it("does not use MySQL-incompatible IF NOT EXISTS syntax for alters or indexes", () => {
    expect(migration).not.toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
    expect(migration).not.toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    expect(migration).toMatch(/ALTER TABLE ats_notification_log ADD COLUMN notification_type/i);
    expect(migration).toMatch(/ALTER TABLE ats_candidate ADD INDEX idx_ats_candidate_branch \(applied_for_branch\)/i);
    expect(migration).not.toMatch(/ALTER TABLE ats_candidate ADD INDEX idx_ats_candidate_branch \(branch_name\)/i);
  });

  it("creates ats_notification_log before enhancing it", () => {
    const createIndex = migration.search(/CREATE TABLE IF NOT EXISTS ats_notification_log/i);
    const alterIndex = migration.search(/ALTER TABLE ats_notification_log ADD COLUMN notification_type/i);

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(alterIndex).toBeGreaterThan(createIndex);
    expect(migration).toMatch(/event_type VARCHAR\(100\) NOT NULL/i);
    expect(migration).toMatch(/notification_title VARCHAR\(255\) NOT NULL/i);
    expect(migration).toMatch(/notification_body TEXT NOT NULL/i);
  });

  it("adds candidate_status before indexing it", () => {
    const columnIndex = migration.search(/ALTER TABLE ats_candidate ADD COLUMN candidate_status VARCHAR\(50\) NULL/i);
    const indexIndex = migration.search(/ALTER TABLE ats_candidate ADD INDEX idx_ats_candidate_status \(candidate_status\)/i);

    expect(columnIndex).toBeGreaterThanOrEqual(0);
    expect(indexIndex).toBeGreaterThan(columnIndex);
  });
});
