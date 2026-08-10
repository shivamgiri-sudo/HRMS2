import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../sql/038_engagement_gamification.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

function position(fragment: string): number {
  const index = sql.indexOf(fragment);
  expect(index, `Expected migration 038 to contain: ${fragment}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("038 engagement/gamification fresh-schema contract", () => {
  it("creates the badge table before executing badge compatibility ALTER statements", () => {
    expect(position("CREATE TABLE IF NOT EXISTS gamification_badge_master"))
      .toBeLessThan(position("-- 0. SCHEMA COMPATIBILITY FOR gamification_badge_master"));
  });

  it("creates employee_badge_earned before executing its compatibility ALTER statements", () => {
    expect(position("CREATE TABLE IF NOT EXISTS employee_badge_earned"))
      .toBeLessThan(position("-- 0B. SCHEMA COMPATIBILITY FOR employee_badge_earned"));
  });

  it("does not rename a legacy column over an already-present canonical column", () => {
    expect(sql).toContain("@has_old>0 AND @has_new=0");
    expect(sql).toMatch(/COLUMN_NAME='category'[\s\S]*COLUMN_NAME='badge_category'[\s\S]*@has_old>0 AND @has_new=0/);
    expect(sql).toMatch(/COLUMN_NAME='point_value'[\s\S]*COLUMN_NAME='points_value'[\s\S]*@has_old>0 AND @has_new=0/);
    expect(sql).toMatch(/COLUMN_NAME='active_status'[\s\S]*COLUMN_NAME='is_active'[\s\S]*@has_old>0 AND @has_new=0/);
    expect(sql).toMatch(/COLUMN_NAME='earned_date'[\s\S]*COLUMN_NAME='earned_at'[\s\S]*@has_old>0 AND @has_new=0/);
  });

  it("seeds survey_question using the canonical fresh-table columns", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS survey_question[\s\S]*question_id CHAR\(36\) PRIMARY KEY[\s\S]*question_order INT NOT NULL/);
    expect(sql).toMatch(/INSERT IGNORE INTO survey_question\s*\(question_id, survey_id, question_text, question_type, question_order, is_required, options_json\)/);
    expect(sql).not.toMatch(/INSERT IGNORE INTO survey_question\s*\(id,/);
    expect(sql).not.toMatch(/INSERT IGNORE INTO survey_question[\s\S]{0,200}\bdisplay_order\b/);
  });
});
