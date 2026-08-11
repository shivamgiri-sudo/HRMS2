import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../../sql/139_ats_enhanced_journey_safe.sql"), "utf8");

describe("ATS enhanced journey migration", () => {
  it("adds employee_code_sequence columns before seeding them", () => {
    const isOffroleColumn = migration.search(/ALTER TABLE employee_code_sequence ADD COLUMN is_offrole BOOLEAN DEFAULT FALSE/i);
    const currentSequenceColumn = migration.search(/ALTER TABLE employee_code_sequence ADD COLUMN current_sequence INT NOT NULL DEFAULT 0/i);
    const insert = migration.search(/INSERT INTO employee_code_sequence \(company_prefix, is_offrole, current_sequence\)/i);

    expect(isOffroleColumn).toBeGreaterThanOrEqual(0);
    expect(currentSequenceColumn).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(isOffroleColumn);
    expect(insert).toBeGreaterThan(currentSequenceColumn);
    expect(migration).toMatch(/ON DUPLICATE KEY UPDATE/i);
  });
});
