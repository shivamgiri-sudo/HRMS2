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

  it("adds module_access_control columns before granting access", () => {
    const employeeCodeColumn = migration.search(/ALTER TABLE module_access_control ADD COLUMN employee_code VARCHAR\(50\) NULL/i);
    const hasAccessColumn = migration.search(/ALTER TABLE module_access_control ADD COLUMN has_access BOOLEAN DEFAULT TRUE/i);
    const insert = migration.search(/INSERT INTO module_access_control \(\s*employee_id, module_code, module_name, employee_code, has_access, access_granted, granted_by, remarks\s*\)/i);

    expect(employeeCodeColumn).toBeGreaterThanOrEqual(0);
    expect(hasAccessColumn).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(employeeCodeColumn);
    expect(insert).toBeGreaterThan(hasAccessColumn);
    expect(migration).toMatch(/SELECT id FROM employees WHERE employee_code = 'MAS47814' LIMIT 1/i);
  });

  it("adds interviewed_at before indexing interview results by date", () => {
    const column = migration.search(/ALTER TABLE ats_interview_result ADD COLUMN interviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP/i);
    const index = migration.search(/CREATE INDEX idx_interview_date ON ats_interview_result\(interviewed_at\)/i);

    expect(column).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(column);
  });
});
