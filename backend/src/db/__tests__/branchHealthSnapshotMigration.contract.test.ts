import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

// Migration 2216: branch_health_snapshot. Daily per-branch score + metrics for the Branch Head Health trend.
// Additive side table: one CREATE TABLE, no FK, no ALTER of any existing table.
const FILE = "2216_branch_health_snapshot.sql";
const sqlPath = path.resolve(__dirname, "../../../sql/migrations", FILE);
const manifest = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const statements = splitSql(code).map((s) => s.replace(/\s+/g, " ").trim());

describe("migration 2216 branch_health_snapshot", () => {
  it("file exists and is registered right after 2214", () => {
    expect(fs.existsSync(sqlPath)).toBe(true);
    const entries = [...manifest.matchAll(/^\s*"(migrations\/[^"]+\.sql)",/gm)].map((m) => m[1]);
    expect(entries.indexOf(`migrations/${FILE}`)).toBe(entries.indexOf("migrations/2214_cost_centre_process_link.sql") + 1);
  });

  it("creates the table with a unique (branch_id, snap_date) and the repo collation", () => {
    const create = statements.find((s) => s.includes("CREATE TABLE IF NOT EXISTS branch_health_snapshot (")) ?? "";
    for (const part of [
      "id CHAR(36) NOT NULL PRIMARY KEY",
      "branch_id CHAR(36) NOT NULL",
      "snap_date DATE NOT NULL",
      "score DECIMAL(5,2) NOT NULL",
      "pillars_json JSON NULL",
      "metrics_json JSON NULL",
      "UNIQUE KEY uq_bhs_branch_date (branch_id, snap_date)",
      "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    ]) expect(create, part).toContain(part);
  });

  it("is additive: no FK, no ALTER, single statement", () => {
    expect(code).not.toMatch(/FOREIGN KEY|REFERENCES|ALTER\s+TABLE|DROP\s|DELETE\s|TRUNCATE/i);
    expect(statements).toHaveLength(1);
  });
});
