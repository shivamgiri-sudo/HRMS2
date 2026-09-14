import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/202_onboarding_v2_court_check.sql"), "utf8");

describe("onboarding v2 court-check migration", () => {
  it("creates onboarding experience before altering manager fields", () => {
    const createTableOffset = migration.search(/CREATE TABLE IF NOT EXISTS candidate_onboarding_experience/i);
    const firstAlterOffset = migration.search(/ALTER TABLE candidate_onboarding_experience/i);

    expect(createTableOffset).toBeGreaterThanOrEqual(0);
    expect(firstAlterOffset).toBeGreaterThan(createTableOffset);
  });

  it("creates onboarding qualification before altering education BGV fields", () => {
    const createTableOffset = migration.search(/CREATE TABLE IF NOT EXISTS candidate_onboarding_qualification/i);
    const firstAlterOffset = migration.search(/ALTER TABLE candidate_onboarding_qualification/i);

    expect(createTableOffset).toBeGreaterThanOrEqual(0);
    expect(firstAlterOffset).toBeGreaterThan(createTableOffset);
  });

  it("includes columns written by the onboarding service", () => {
    expect(migration).toMatch(/working_experience VARCHAR\(50\) NULL/i);
    expect(migration).toMatch(/experience_document_id CHAR\(36\) NULL/i);
    expect(migration).toMatch(/reason_for_leaving VARCHAR\(500\) NULL/i);
    expect(migration).toMatch(/specialization_course_name VARCHAR\(255\) NULL/i);
    expect(migration).toMatch(/passed_out_percentage DECIMAL\(5,2\) NULL/i);
    expect(migration).toMatch(/document_id CHAR\(36\) NULL/i);
  });
});
