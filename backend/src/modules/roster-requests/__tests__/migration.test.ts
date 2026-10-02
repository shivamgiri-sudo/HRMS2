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
