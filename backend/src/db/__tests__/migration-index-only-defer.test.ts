import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isIndexOnlyMigrationSql, isTransientMigrationError } from "../runPendingMigrations.js";

/**
 * 2026-09-30 outage: migration 1918 (19 ADD INDEX statements, several on `employees`) timed out on a
 * metadata lock and, because the runner treats any failed migration as fatal in production, the
 * server refused to start (~30+ min of 502). A performance index is never a startup dependency, so
 * an index-only migration that hits a lock timeout is deferred; everything else stays fatal.
 */

const sqlDir = path.resolve(__dirname, "../../../sql/migrations");
const read = (f: string) => fs.readFileSync(path.join(sqlDir, f), "utf8");

describe("isIndexOnlyMigrationSql", () => {
  it("classifies the migration that caused the outage as index-only", () => {
    const f = "1918_operations_command_indexes.sql";
    if (!fs.existsSync(path.join(sqlDir, f))) return; // file lives on main; skip if absent in a sparse checkout
    expect(isIndexOnlyMigrationSql(read(f))).toBe(true);
  });

  it("accepts the plain and PREPARE-guarded ADD INDEX shapes", () => {
    expect(isIndexOnlyMigrationSql("ALTER TABLE t ADD INDEX i (a, b), ALGORITHM=INPLACE, LOCK=NONE;")).toBe(true);
    expect(isIndexOnlyMigrationSql("CREATE INDEX i ON t (a);")).toBe(true);
    expect(
      isIndexOnlyMigrationSql(`
        SET @c = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_NAME='t' AND INDEX_NAME='i');
        SET @s = IF(@c = 0, 'ALTER TABLE t ADD INDEX i (a, b)', 'SELECT 1');
        PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;`),
    ).toBe(true);
    expect(isIndexOnlyMigrationSql("ALTER TABLE t ADD INDEX a1 (x), ADD UNIQUE KEY a2 (y);")).toBe(true);
  });

  it("ignores comments that mention forbidden words", () => {
    expect(
      isIndexOnlyMigrationSql("-- drop the old one later, update nothing\n/* delete no rows */\nALTER TABLE t ADD INDEX i (a);"),
    ).toBe(true);
  });

  it("rejects anything that is not purely an index", () => {
    const bad = [
      "ALTER TABLE t ADD COLUMN c INT;",
      "ALTER TABLE t ADD INDEX i (a); ALTER TABLE t ADD COLUMN c INT;",
      "ALTER TABLE t DROP INDEX i;",
      "ALTER TABLE t ADD INDEX i (a); DROP TABLE x;",
      "ALTER TABLE t ADD INDEX i (a); UPDATE t SET a = 1;",
      "ALTER TABLE t ADD INDEX i (a); INSERT INTO t VALUES (1);",
      "ALTER TABLE t ADD INDEX i (a); DELETE FROM t;",
      "ALTER TABLE t ADD INDEX i (a); CREATE TABLE z (id INT);",
      "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES u(id);",
      "ALTER TABLE t MODIFY COLUMN a BIGINT, ADD INDEX i (a);",
      "ALTER TABLE t ADD INDEX i (a), CHANGE a b INT;",
      "ALTER TABLE t ADD PRIMARY KEY (id);",
      "SELECT 1;", // no index at all
      "",
    ];
    for (const sql of bad) expect(isIndexOnlyMigrationSql(sql), sql).toBe(false);
  });

  it("does not treat a column named like a keyword as a data change", () => {
    expect(isIndexOnlyMigrationSql("ALTER TABLE t ADD INDEX i (updated_at, deleted_flag);")).toBe(true);
  });
});

describe("runner wiring", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");

  it("defers only transient errors on index-only files, and keeps every other failure fatal", () => {
    expect(src).toMatch(/isTransientMigrationError\(error\)[\s\S]{0,200}isIndexOnlyMigrationSql\(/);
    expect(src).toMatch(/if \(deferIndexOnly\)[\s\S]{0,300}migrationHealth\.skipped\.push\(file\)/);
    expect(src).toMatch(/else \{\s*migrationHealth\.failed\.push\(\{ filename: file, error: message \}\)/);
  });

  it("still records the deferred attempt with success = false so the next boot retries it", () => {
    expect(src).toMatch(/DEFERRED \(lock contention on an index-only migration; retried on next boot\)/);
    expect(src).toMatch(/\{ success: false \}[\s\S]{0,400}errorMessage: message/);
  });

  it("a lock timeout is a transient error (the deferral precondition)", () => {
    expect(isTransientMigrationError({ code: "ER_LOCK_WAIT_TIMEOUT" })).toBe(true);
    expect(isTransientMigrationError({ errno: 1205 })).toBe(true);
    expect(isTransientMigrationError({ code: "ER_PARSE_ERROR", errno: 1064 })).toBe(false);
  });
});
