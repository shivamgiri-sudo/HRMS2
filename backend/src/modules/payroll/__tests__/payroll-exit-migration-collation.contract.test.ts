import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(__dirname, "../../../../sql/018_payroll_exit_completion.sql"),
  "utf8",
);

describe("payroll exit completion migration", () => {
  it("does not force table collations on CHAR(36) foreign-key tables", () => {
    expect(migration).toMatch(/REFERENCES\s+exit_request\s*\(\s*id\s*\)/i);
    expect(migration).toMatch(/REFERENCES\s+salary_prep_run\s*\(\s*id\s*\)/i);

    for (const table of [
      "tax_declaration",
      "full_final_calculation",
      "payroll_disbursement",
    ]) {
      const createTable = migration.match(
        new RegExp(
          `CREATE TABLE IF NOT EXISTS ${table}[\\s\\S]*?\\) ENGINE=InnoDB;`,
          "i",
        ),
      )?.[0];

      expect(createTable, `${table} definition`).toBeTruthy();
      expect(createTable).not.toMatch(/\bDEFAULT\s+CHARSET\b/i);
      expect(createTable).not.toMatch(/\bCOLLATE\b/i);
    }
  });
});
