import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("smart GRN validation schema hardening", () => {
  it("adds missing override metadata without replacing validation data", () => {
    const sql = read("sql/420_grn_validation_schema_hardening.sql");
    expect(sql).toContain("information_schema.COLUMNS");
    expect(sql).toContain("overridden_by");
    expect(sql).toContain("override_reason");
    expect(sql).toContain("overridden_at");
    expect(sql).toContain("ENUM('passed','warning','failed','overridden')");
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE\s+TABLE/i);
  });

  it("runs hardening after the base finance migrations, via the single governed manifest, before runtime", () => {
    // The two ungoverned supplemental/hardening runners this test used to check (and their
    // "hardening runs after supplemental" call-order assertion) were retired once their coverage
    // was confirmed fully redundant with MIGRATION_MANIFEST — see PR 5 of the finance
    // stabilization work. Same intent (420 must run after the 415-419 migrations it hardens),
    // now expressed as manifest ordering instead of two removed function-call sites.
    const runner = read("src/db/runPendingMigrations.ts");
    const server = read("src/server.ts");
    const manual = read("sql/000_finance_supplemental.sql");
    const migrationStart = server.lastIndexOf("handleMigrations()");
    const runtimeStart = server.indexOf(".then(initializeRuntime)");
    const index419 = runner.indexOf('"419_grn_validation_override_control.sql"');
    const index420 = runner.indexOf('"420_grn_validation_schema_hardening.sql"');

    expect(index419).toBeGreaterThan(-1);
    expect(index420).toBeGreaterThan(index419);
    expect(migrationStart).toBeGreaterThan(-1);
    expect(runtimeStart).toBeGreaterThan(migrationStart);
    expect(manual).toContain("SOURCE sql/420_grn_validation_schema_hardening.sql;");
  });
});
