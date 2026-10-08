import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/042_maternity_schema_patch.sql"), "utf8");

describe("maternity schema patch migration", () => {
  it("does not force a different collation on the branch foreign-key table", () => {
    expect(migration).toMatch(/REFERENCES\s+branch_master\s*\(\s*id\s*\)/i);
    expect(migration).not.toMatch(/\bDEFAULT\s+CHARSET\b/i);
    expect(migration).not.toMatch(/\bCOLLATE\b/i);
  });
});
