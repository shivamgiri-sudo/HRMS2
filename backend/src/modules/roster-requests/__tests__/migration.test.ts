import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { splitSql } from "../../../db/runPendingMigrations.js";

describe("roster requests migration", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../../sql/migrations/1995_roster_request_decision_log_auto_rule.sql"), "utf8");
  it("creates the three tables idempotently", () => {
    for (const t of ["roster_request_decision_log", "roster_request_auto_rule", "roster_request_escalation"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
    expect(sql).toContain("UNIQUE KEY uq_kind_source (kind, source_id)");
    expect(sql).toContain("UNIQUE KEY uq_process_kind (process_id, kind)");
  });

  it("is scheduled by the migration runner manifest", () => {
    // Files under sql/migrations/ run only when MIGRATION_MANIFEST names them; the guard test does not
    // flag an unlisted subdirectory file. Without this entry none of the three tables is ever created,
    // and a hub week-off decision rolls back on its decision-log INSERT (ER_NO_SUCH_TABLE).
    const runner = readFileSync(path.resolve(__dirname, "../../../db/runPendingMigrations.ts"), "utf8");
    const manifest = runner.slice(runner.indexOf("MIGRATION_MANIFEST"), runner.indexOf("export type MigrationHealth"));
    expect(manifest).toContain('"migrations/1995_roster_request_decision_log_auto_rule.sql"');
  });

  it("splits into exactly its three CREATE TABLE statements", () => {
    const statements = splitSql(sql);
    expect(statements).toHaveLength(3);
    for (const s of statements) expect(s).toMatch(/^CREATE TABLE IF NOT EXISTS roster_request_/);
  });
});

describe("roster requests raised-at migration (2074)", () => {
  const file = "2074_roster_request_raised_at.sql";
  const sql = readFileSync(path.resolve(__dirname, `../../../../sql/migrations/${file}`), "utf8");

  it("is scheduled by the migration runner manifest", () => {
    // Same trap as 1995: an unlisted file under sql/migrations/ never runs, and the dispute handler
    // would then write a column that does not exist.
    const runner = readFileSync(path.resolve(__dirname, "../../../db/runPendingMigrations.ts"), "utf8");
    const manifest = runner.slice(runner.indexOf("MIGRATION_MANIFEST"), runner.indexOf("export type MigrationHealth"));
    expect(manifest).toContain(`"migrations/${file}"`);
  });

  it("adds roster_daily_assignment.disputed_at as a nullable column, guarded on information_schema", () => {
    expect(sql).toContain("ALTER TABLE roster_daily_assignment ADD COLUMN disputed_at DATETIME NULL");
    expect(sql).toMatch(/TABLE_NAME = 'roster_daily_assignment' AND COLUMN_NAME = 'disputed_at'/);
    expect(sql).not.toMatch(/disputed_at DATETIME NULL DEFAULT/);
  });

  it("backfills only rows that need it, and runs no DDL against wfm_roster_assignment", () => {
    expect(sql).toContain("SET disputed_at = updated_at WHERE acknowledgement_status = ''disputed'' AND disputed_at IS NULL");
    expect(sql).toContain("SET employee_ack_at = updated_at WHERE employee_ack_status = ''rejected'' AND employee_ack_at IS NULL");
    expect(sql).not.toMatch(/ALTER TABLE wfm_roster_assignment/);
  });

  it("splits into guard / prepare / execute statements only", () => {
    const statements = splitSql(sql);
    for (const s of statements) expect(s).toMatch(/^(SET @|PREPARE |EXECUTE |DEALLOCATE )/);
    expect(statements.filter((s) => s.startsWith("EXECUTE"))).toHaveLength(3);
  });
});
