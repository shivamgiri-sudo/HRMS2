import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

// Migration 2145 (selection criteria, S2): job_requisition.selection_rules, criteria versions + audit,
// and the qualified_followup criteria columns. Pure addition, re-runnable, no FKs.
const FILE = "2145_requisition_selection_rules.sql";
const sqlPath = path.resolve(__dirname, "../../../sql/migrations", FILE);
const manifest = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";
const statements = () => splitSql(sql);
const createOf = (table: string) => statements().find((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${table} (`)) ?? "";

describe("migration 2145 selection rules", () => {
  it("exists and is registered as the last manifest entry", () => {
    expect(sql).not.toBe("");
    const entries = [...manifest.matchAll(/^\s*"(migrations\/[^"]+\.sql)",/gm)].map((m) => m[1]);
    expect(entries.at(-1)).toBe(`migrations/${FILE}`);
    expect(entries.filter((e) => e.includes("/2145_"))).toHaveLength(1);
  });

  it("adds job_requisition.selection_rules JSON NULL only when absent", () => {
    const alter = statements().find((s) => s.includes("ADD COLUMN selection_rules")) ?? "";
    expect(alter).toMatch(/TABLE_NAME = 'job_requisition' AND COLUMN_NAME = 'selection_rules'\) = 0/);
    expect(alter).toContain("ALTER TABLE job_requisition ADD COLUMN selection_rules JSON NULL");
  });

  it("creates the version and audit tables only if missing, with the planned keys", () => {
    const v = createOf("job_requisition_criteria_version");
    expect(v).toContain("UNIQUE KEY uq_rcv (requisition_id, version_no)");
    expect(v).toContain("KEY idx_rcv_hash (requisition_id, criteria_hash)");
    for (const col of ["criteria_hash CHAR(64) NOT NULL", "compiled_json JSON NOT NULL", "columns_json JSON NOT NULL", "engine_version SMALLINT NOT NULL", "source VARCHAR(16) NOT NULL", "reason VARCHAR(300) NULL"]) {
      expect(v).toContain(col);
    }
    const a = createOf("job_requisition_criteria_audit");
    expect(a).toContain("id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY");
    expect(a).toContain("KEY idx_rca_req (requisition_id, created_at)");
    for (const col of ["field VARCHAR(64) NOT NULL", "old_json JSON NULL", "new_json JSON NULL", "actor_id CHAR(36) NOT NULL", "approval_status_at_change VARCHAR(20) NOT NULL"]) {
      expect(a).toContain(col);
    }
  });

  it.each(["criteria_version_id", "criteria_verdict", "criteria_checked_at"])("qualified_followup.%s is guarded and skipped when the table is absent", (col) => {
    const st = statements().find((s) => s.includes(`ADD COLUMN ${col} `)) ?? "";
    expect(st).toMatch(/information_schema\.TABLES WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'qualified_followup'\) = 1/);
    expect(st).toContain(`TABLE_NAME = 'qualified_followup' AND COLUMN_NAME = '${col}') = 0`);
  });

  it("has no FKs, no IF NOT EXISTS on columns/indexes, and unicode collation on every new table", () => {
    const executable = statements().join("\n");
    expect(executable).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    expect(executable).not.toMatch(/ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS/i);
    for (const t of ["job_requisition_criteria_version", "job_requisition_criteria_audit"]) {
      expect(createOf(t)).toContain("DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
  });
});
