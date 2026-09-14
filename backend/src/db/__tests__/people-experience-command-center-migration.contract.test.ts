import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/204_people_experience_command_center.sql"), "utf8");

describe("people experience command center migration", () => {
  it("does not use MySQL-incompatible ADD COLUMN IF NOT EXISTS syntax", () => {
    expect(migration).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });

  it("adds support columns through a guarded dynamic helper", () => {
    expect(migration).toMatch(/CREATE PROCEDURE _204_add_col/i);
    expect(migration).toMatch(/information_schema\.COLUMNS/i);
    expect(migration).toMatch(/CALL _204_add_col\('helpdesk_ticket', 'sla_due_at', 'DATETIME NULL'\)/i);
    expect(migration).toMatch(/CALL _204_add_col\('grievance', 'severity', 'VARCHAR\(20\) NOT NULL DEFAULT ''medium'''\)/i);
    expect(migration).toMatch(/DROP PROCEDURE IF EXISTS _204_add_col/i);
  });
});
