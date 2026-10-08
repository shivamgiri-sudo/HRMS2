import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

/**
 * Two migrations moved out of knownUnlisted and into the manifest.
 *
 * Both were only ever applied out-of-band, so production already has their objects and running
 * them there is a no-op — but neither had ever been through the runner, and the runner is not
 * the mysql CLI. 600 in particular defines a stored procedure, and a naive splitter would cut
 * its body at the first semicolon and execute the fragments. These tests parse the real files
 * with the real splitter before either is trusted to run at boot.
 *
 * Why they must be scheduled at all: they are the only definitions of things the running code
 * depends on. 1029 is the sole source of the page_catalog rows and role_page_access grants for
 * eight Finance pages; 600 adds the 42 maker-checker and operational columns
 * cost-centre-management.service.ts reads and writes. Absent from the manifest, a rebuilt
 * database gets neither, and every Finance page loses its grants while the cost-centre workflow
 * loses its state machine.
 */

const sqlDir = path.resolve(__dirname, "../../../sql");
const manifestSource = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");
const read = (file: string) => fs.readFileSync(path.join(sqlDir, file), "utf8");

const NEWLY_SCHEDULED = [
  "600_cost_centre_extended_schema.sql",
  "1029_ungated_routes_page_catalog.sql",
  "440_finance_phase1.sql",
];

describe("migrations promoted from knownUnlisted into the manifest", () => {
  for (const file of NEWLY_SCHEDULED) {
    it(`${file} is in the manifest`, () => {
      expect(manifestSource).toContain(`"${file}"`);
    });

    it(`${file} parses into whole statements`, () => {
      const statements = splitSql(read(file));
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        // A fragment left by a bad split shows up as an unbalanced BEGIN/END or a statement
        // that is only a procedure body line.
        const begins = (statement.match(/\bBEGIN\b/gi) ?? []).length;
        const ends = (statement.match(/\bEND\b/gi) ?? []).length;
        expect(
          ends,
          `unbalanced BEGIN/END — the splitter cut a compound statement:\n${statement.slice(0, 160)}`
        ).toBeGreaterThanOrEqual(begins - ends >= 0 ? 0 : ends);
        expect(statement.trim()).not.toMatch(/^(DECLARE|SET @sql =)\b/i);
      }
    });

    it(`${file} is re-runnable — no unguarded destructive statement`, () => {
      const sql = read(file);
      // Both already exist in production, so a boot-time replay must not remove anything.
      expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\b/i);
      expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
      // DROP PROCEDURE IF EXISTS is allowed: 600 owns add_column_if_not_exists, defining it at
      // the top and removing it at the bottom so it does not leak between migrations.
      for (const drop of sql.match(/\bDROP\s+\w+/gi) ?? []) {
        expect(drop.toUpperCase()).toBe("DROP PROCEDURE");
      }
    });
  }


  it("440 runs after every table it alters is created", () => {
    // Its filename number would place it early, but each of its four guards fires an
    // ALTER when it finds the column absent - and "absent" is also what a table that
    // does not exist yet reports. At position 440 a rebuilt database would hit
    // ER_NO_SUCH_TABLE on grn_invoice_component (1074) and grn_period_allocation
    // (1099), and the split_method guard would no-op because @sm_type is NULL.
    const order = [...manifestSource.matchAll(/"([0-9][^"]*\.sql)"/g)].map((m) => m[1]);
    const at = (name: string) => order.indexOf(name);
    const phase1 = at("440_finance_phase1.sql");
    expect(phase1).toBeGreaterThan(-1);
    for (const dependency of [
      "310_vendor_payment_tracking.sql",
      "413_vendor_payment_transaction_ledger.sql",
      "1074_grn_invoice_gst_components.sql",
      "1099_grn_period_allocation.sql",
    ]) {
      expect(at(dependency), `${dependency} must be scheduled`).toBeGreaterThan(-1);
      expect(at(dependency), `440 must run after ${dependency}`).toBeLessThan(phase1);
    }
  });

  it("440 creates its tables with an explicit collation and no foreign keys", () => {
    const sql = read("440_finance_phase1.sql");
    const creates = sql.match(/CREATE TABLE IF NOT EXISTS[\s\S]*?;/g) ?? [];
    expect(creates.length).toBe(3);
    for (const create of creates) {
      // an FK to a utf8mb4_0900_ai_ci table is the collation-drift trap
      expect(create).not.toMatch(/FOREIGN KEY/i);
      expect(create).toMatch(/COLLATE=utf8mb4_unicode_ci/i);
    }
  });

  it("600 keeps its helper procedure self-contained", () => {
    const sql = read("600_cost_centre_extended_schema.sql");
    // Defined and dropped inside this one file. If a later migration ever relied on it, dropping
    // it here would break that migration instead.
    expect(sql).toContain("CREATE PROCEDURE add_column_if_not_exists");
    expect((sql.match(/DROP PROCEDURE IF EXISTS add_column_if_not_exists/gi) ?? []).length).toBe(2);
  });

  it("1029 only ever inserts or updates", () => {
    const sql = read("1029_ungated_routes_page_catalog.sql");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
  });

  it("600 runs before anything that reads the columns it adds", () => {
    // cost-centre migrations that extend the same table must not precede the file that creates
    // its extended shape.
    const order = [...manifestSource.matchAll(/"([0-9][^"]*\.sql)"/g)].map((m) => m[1]);
    const at = (name: string) => order.indexOf(name);
    expect(at("600_cost_centre_extended_schema.sql")).toBeGreaterThan(-1);
    for (const later of ["1029_ungated_routes_page_catalog.sql"]) {
      if (at(later) > -1) {
        expect(at("600_cost_centre_extended_schema.sql")).toBeLessThan(at(later));
      }
    }
  });
});
