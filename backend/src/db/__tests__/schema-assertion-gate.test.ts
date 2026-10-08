import { describe, expect, it } from "vitest";
import { parseDeclaredSchema } from "../runPendingMigrations.js";

/**
 * Gate 3: a migration that ran without throwing must also have left the schema it declares.
 *
 * These tests are mostly about the parser REFUSING to assert. A false positive blocks production
 * startup, because a failed migration halts the chain — so the expensive direction of error is
 * over-claiming, not under-claiming. Each skip case below is a real shape from backend/sql.
 */
describe("parseDeclaredSchema", () => {
  it("reads a plain CREATE TABLE", () => {
    const d = parseDeclaredSchema("CREATE TABLE IF NOT EXISTS statutory_filing_record (id CHAR(36));");
    expect(d.tables).toEqual(["statutory_filing_record"]);
    expect(d.skipped).toBe(false);
  });

  it("reads ADD COLUMN, including the MariaDB spelling that started all this", () => {
    const d = parseDeclaredSchema(`
      ALTER TABLE salary_prep_line
        ADD COLUMN IF NOT EXISTS payslip_emailed    TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS payslip_emailed_at DATETIME NULL;
    `);
    expect(d.columns).toEqual([
      { table: "salary_prep_line", column: "payslip_emailed" },
      { table: "salary_prep_line", column: "payslip_emailed_at" },
    ]);
  });

  it("lowercases identifiers so MySQL's real case cannot cause a false miss", () => {
    const d = parseDeclaredSchema("ALTER TABLE Salary_Prep_Run ADD COLUMN Incentives_Applied_At DATETIME NULL;");
    expect(d.columns).toEqual([{ table: "salary_prep_run", column: "incentives_applied_at" }]);
  });

  // ─── the refusals ──────────────────────────────────────────────────────────

  it("refuses any file that drops, renames or changes a column", () => {
    for (const sql of [
      "ALTER TABLE a ADD COLUMN x INT; ALTER TABLE a DROP COLUMN y;",
      "ALTER TABLE a ADD COLUMN x INT; RENAME TABLE a TO b;",
      "ALTER TABLE a ADD COLUMN x INT; ALTER TABLE a CHANGE COLUMN p q INT;",
      "DROP INDEX idx_a ON a;",
    ]) {
      const d = parseDeclaredSchema(sql);
      expect(d.skipped, sql).toBe(true);
      expect(d.tables.concat(d.columns.map((c) => c.column))).toEqual([]);
    }
  });

  it("ignores TEMPORARY tables, which are gone before the check runs", () => {
    const d = parseDeclaredSchema("CREATE TEMPORARY TABLE probe (id INT);");
    expect(d.tables).toEqual([]);
  });

  /**
   * 342_masmis_upload_tables.sql declares tables in db_masmis, a schema this account cannot see.
   * It was the only false positive in the 2026-08-13 column sweep, and blocking startup on it
   * would be the exact outage this guard is supposed to prevent.
   */
  it("ignores schema-qualified objects in another database", () => {
    const d = parseDeclaredSchema("CREATE TABLE IF NOT EXISTS db_masmis.bvo_order_export (id INT);");
    expect(d.tables).toEqual([]);
    const a = parseDeclaredSchema("ALTER TABLE db_masmis.foo ADD COLUMN bar INT;");
    expect(a.columns).toEqual([]);
  });

  it("does not read DDL out of comments", () => {
    const d = parseDeclaredSchema(`
      -- CREATE TABLE ghost_one (id INT);
      /* ALTER TABLE ghost_two ADD COLUMN ghost_col INT; */
      CREATE TABLE real_one (id INT);
    `);
    expect(d.tables).toEqual(["real_one"]);
    expect(d.columns).toEqual([]);
  });

  /**
   * The guarded information_schema + PREPARE idiom builds its DDL inside a string literal. The
   * parser cannot see in, and must not half-see in either — a stray CREATE TABLE lifted out of a
   * quoted string would be asserted against a database that never ran it.
   */
  it("does not read DDL out of string literals", () => {
    const d = parseDeclaredSchema(`
      SET @ddl := IF(@col_exists = 0,
        'ALTER TABLE employees ADD COLUMN aadhaar_blind_index CHAR(64) NULL',
        'SELECT 1');
      PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    `);
    expect(d.columns).toEqual([]);
    expect(d.tables).toEqual([]);
  });

  it("asserts nothing for a data-only migration", () => {
    const d = parseDeclaredSchema("INSERT INTO page_catalog (code) VALUES ('FINANCE_GRN');");
    expect(d.tables).toEqual([]);
    expect(d.columns).toEqual([]);
    expect(d.skipped).toBe(false);
  });
});
