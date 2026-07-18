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

  it("runs hardening after all Finance supplemental migrations and before runtime", () => {
    const runner = read("src/db/runFinanceSchemaHardeningMigrations.ts");
    const server = read("src/server.ts");
    const manual = read("sql/000_finance_hardening.sql");
    expect(runner).toContain('"420_grn_validation_schema_hardening.sql"');
    expect(runner).toContain("schema_migrations");
    expect(server).toContain("runFinanceSchemaHardeningMigrations");
    expect(server.indexOf("runFinanceSupplementalMigrations")).toBeLessThan(
      server.lastIndexOf("runFinanceSchemaHardeningMigrations")
    );
    expect(server.indexOf(".then(runFinanceSchemaHardeningMigrations)")).toBeLessThan(
      server.indexOf(".then(initializeRuntime)")
    );
    expect(manual).toContain("SOURCE sql/420_grn_validation_schema_hardening.sql;");
  });
});
