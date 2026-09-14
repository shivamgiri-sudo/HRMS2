import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(__dirname, "../../../../sql/037_performance_feedback.sql"),
  "utf8",
);

describe("performance feedback migration", () => {
  it("does not force a different collation on tables with CHAR(36) foreign keys", () => {
    expect(migration).toMatch(/REFERENCES\s+employees\s*\(\s*id\s*\)/i);
    expect(migration).toMatch(/REFERENCES\s+appraisal_cycle\s*\(\s*id\s*\)/i);
    expect(migration).toMatch(/REFERENCES\s+training_need\s*\(\s*id\s*\)/i);

    for (const table of [
      "performance_feedback_cycle",
      "performance_feedback_request",
      "performance_feedback_report",
      "development_plan",
      "development_plan_goal",
    ]) {
      const createTable = migration.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}[\\s\\S]*?\\) ENGINE=InnoDB;`, "i"),
      )?.[0];

      expect(createTable, `${table} definition`).toBeTruthy();
      expect(createTable).not.toMatch(/\bDEFAULT\s+CHARSET\b/i);
      expect(createTable).not.toMatch(/\bCOLLATE\b/i);
    }
  });
});
