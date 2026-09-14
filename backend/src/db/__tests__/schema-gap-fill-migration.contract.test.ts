import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/041_schema_gap_fill.sql"), "utf8");

describe("schema gap-fill migration", () => {
  it("does not drop employee_id indexes that can back foreign keys", () => {
    expect(migration).not.toMatch(/ALTER TABLE employee_emergency_contact DROP INDEX employee_id/i);
    expect(migration).not.toMatch(/ALTER TABLE employee_bank_detail DROP INDEX employee_id/i);
  });

  it("does not force collations on new employee foreign-key tables", () => {
    expect(migration).toMatch(/REFERENCES\s+employees\s*\(\s*id\s*\)/i);
    expect(migration).not.toMatch(/\bDEFAULT\s+CHARSET\b/i);
    expect(migration).not.toMatch(/\bCOLLATE\b/i);
  });
});
