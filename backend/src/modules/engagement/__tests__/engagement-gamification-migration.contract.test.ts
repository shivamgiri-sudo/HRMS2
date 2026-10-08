import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(__dirname, "../../../../sql/038_engagement_gamification.sql"),
  "utf8",
);
const schemaFixMigration = readFileSync(
  resolve(__dirname, "../../../../sql/1000_fix_engagement_schema_columns.sql"),
  "utf8",
);

describe("engagement gamification migration", () => {
  it("creates badge tables before compatibility ALTERs run on fresh databases", () => {
    const firstCreate = migration.indexOf("CREATE TABLE IF NOT EXISTS gamification_badge_master");
    const firstAlter = migration.indexOf("ALTER TABLE gamification_badge_master");

    expect(firstCreate).toBeGreaterThan(-1);
    expect(firstAlter).toBeGreaterThan(-1);
    expect(firstCreate).toBeLessThan(firstAlter);
  });

  it("keeps employee foreign key columns compatible with employees.id", () => {
    expect(migration).toMatch(/REFERENCES\s+employees\s*\(\s*id\s*\)/i);
    expect(migration).not.toMatch(/employee_id\s+VARCHAR\s*\(\s*36\s*\)[\s\S]{0,300}REFERENCES\s+employees/i);
    expect(migration).not.toMatch(/\bDEFAULT\s+CHARSET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_unicode_ci/i);
  });

  it("matches the survey column names used by the engagement service", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS survey_question\s*\(\s*id CHAR\(36\) PRIMARY KEY/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS survey_response\s*\(\s*id CHAR\(36\) PRIMARY KEY/i);
    expect(migration).toMatch(/FOREIGN KEY \(question_id\) REFERENCES survey_question\(id\)/i);
    expect(migration).not.toContain("display_order");
    expect(migration).not.toContain("response_id CHAR(36) PRIMARY KEY");
    expect(schemaFixMigration).not.toMatch(/ALTER TABLE survey_question DROP COLUMN id/i);
  });
});
