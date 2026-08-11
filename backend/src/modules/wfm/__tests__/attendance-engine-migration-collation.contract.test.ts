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

  it("guards designation-scoped seed data behind an existing designation row", () => {
    expect(migration).toMatch(/FROM\s+designation_master\s+dm/i);
    expect(migration).toMatch(/WHERE\s+dm\.id\s*=\s*'775ef029-5caf-11f1-adb1-00155d0ab410'/i);
    expect(migration).not.toMatch(
      /VALUES\s*\(\s*'arc-agent-001'[\s\S]*'775ef029-5caf-11f1-adb1-00155d0ab410'/i,
    );
  });
});
