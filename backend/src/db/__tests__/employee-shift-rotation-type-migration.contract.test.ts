import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/225_employee_shift_rotation_type.sql"), "utf8");

describe("employee shift rotation type migration", () => {
  it("does not use MySQL-incompatible ADD COLUMN IF NOT EXISTS syntax", () => {
    expect(migration).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });

  it("guards the shift_rotation_type alter with information_schema", () => {
    expect(migration).toMatch(/CREATE PROCEDURE _225_add_shift_rotation_type/i);
    expect(migration).toMatch(/information_schema\.COLUMNS/i);
    expect(migration).toMatch(/COLUMN_NAME = 'shift_rotation_type'/i);
    expect(migration).toMatch(/ADD COLUMN shift_rotation_type/i);
  });
});
