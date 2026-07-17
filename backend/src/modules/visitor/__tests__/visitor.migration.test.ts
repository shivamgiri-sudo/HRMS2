import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitSql } from "../../../db/runPendingMigrations.js";

const migrationPath = new URL("../../../../sql/410_visitor_configuration_branch_fk.sql", import.meta.url);
const manifestPath = new URL("../../../db/runPendingMigrations.ts", import.meta.url);
const bootstrapPath = new URL("../../../../sql/000_run_all.sql", import.meta.url);

describe("visitor migration 410", () => {
  it("stays additive, idempotent, and uses RESTRICT semantics", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("CREATE PROCEDURE IF NOT EXISTS visitor_configuration_branch_fk_410");
    expect(migration).toContain("fk_visitor_config_branch");
    expect(migration).toContain("idx_visitor_configuration_branch_id");
    expect(migration).toMatch(/ON DELETE\s+RESTRICT/i);
    expect(migration).toMatch(/ON UPDATE\s+RESTRICT/i);
    expect(migration).not.toMatch(/\bCASCADE\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("parses through the migration runner without destructive statements", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const statements = splitSql(migration)
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(statements.some((statement) => /^CREATE PROCEDURE IF NOT EXISTS visitor_configuration_branch_fk_410/i.test(statement))).toBe(true);
    expect(statements.some((statement) => /^CALL visitor_configuration_branch_fk_410\(\)\s*;?$/i.test(statement))).toBe(true);
    expect(statements.every((statement) => !/^(DROP|TRUNCATE|DELETE)\b/i.test(statement))).toBe(true);
  });

  it("is registered after 409 in the manifest and bootstrap", () => {
    const manifest = readFileSync(manifestPath, "utf8");
    const bootstrap = readFileSync(bootstrapPath, "utf8");

    expect(manifest).toMatch(/"409_visitor_management_foundation\.sql",\s+"410_visitor_configuration_branch_fk\.sql"/s);
    expect(bootstrap).toMatch(/SOURCE sql\/409_visitor_management_foundation\.sql;\s*SOURCE sql\/410_visitor_configuration_branch_fk\.sql;/s);
  });
});
