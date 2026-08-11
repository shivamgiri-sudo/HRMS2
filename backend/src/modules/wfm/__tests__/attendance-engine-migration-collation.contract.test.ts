import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../../sql/044_attendance_engine.sql"), "utf8");

describe("attendance engine migration", () => {
  it("does not force table collations on attendance foreign-key tables", () => {
    expect(migration).toMatch(/REFERENCES\s+designation_master\s*\(\s*id\s*\)/i);
    expect(migration).toMatch(/REFERENCES\s+employees\s*\(\s*id\s*\)/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS attendance_daily_record/i);
    expect(migration).not.toMatch(/\bDEFAULT\s+CHARSET\b/i);
    expect(migration).not.toMatch(/\bCOLLATE\b/i);
  });
});
