import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/102_biometric_tables.sql"), "utf8");

describe("biometric tables migration", () => {
  it("does not force a table charset that can drift from referenced master tables", () => {
    expect(migration).toMatch(/REFERENCES\s+branch_master\s*\(\s*id\s*\)/i);
    expect(migration).toMatch(/REFERENCES\s+employees\s*\(\s*id\s*\)/i);
    expect(migration).toMatch(/REFERENCES\s+attendance_daily_record\s*\(\s*id\s*\)/i);
    expect(migration).not.toMatch(/\bDEFAULT\s+CHARSET\b/i);
    expect(migration).not.toMatch(/\bCOLLATE\b/i);
  });
});
