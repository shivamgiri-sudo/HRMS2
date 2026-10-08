import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

// Migration 2147 (selection criteria S10-S13): shortlist runs, decisions, overrides (+ log) and HR approvals. Additive, no FKs.
const FILE = "2147_shortlist_decisions.sql";
const sqlPath = path.resolve(__dirname, "../../../sql/migrations", FILE);
const manifest = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";
const table = (t: string) => splitSql(sql).find((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${t} (`)) ?? "";

describe("migration 2147 shortlist decisions", () => {
  it("is registered after 2146", () => {
    const entries = [...manifest.matchAll(/^\s*"(migrations\/[^"]+\.sql)",/gm)].map((m) => m[1]);
    expect(entries.indexOf(`migrations/${FILE}`)).toBe(entries.indexOf("migrations/2146_selection_person_fact.sql") + 1);
  });
  it.each([
    ["shortlist_run", ["id CHAR(36) NOT NULL PRIMARY KEY", "criteria_version_id CHAR(36) NULL", "criteria_hash CHAR(64) NOT NULL", "counts_json JSON NOT NULL", "KEY idx_slr_req (requisition_id, source_kind, created_at)"]],
    ["shortlist_candidate", ["UNIQUE KEY uq_slc_run_person (run_id, mobile10)", "KEY idx_slc_req_person (requisition_id, mobile10)", "rule_results_json JSON NOT NULL", "status VARCHAR(12) NOT NULL"]],
    ["shortlist_override", ["PRIMARY KEY (mobile10, requisition_scope)", "reason VARCHAR(300) NOT NULL", "kind VARCHAR(8) NOT NULL"]],
    ["shortlist_override_log", ["before_json JSON NULL", "after_json JSON NULL", "KEY idx_slol_person (mobile10, created_at)"]],
    ["shortlist_approval", ["mode VARCHAR(10) NOT NULL", "valid_until DATETIME NULL", "revoked_at DATETIME NULL", "KEY idx_sla_req (requisition_id, source_kind, mode)"]],
  ])("%s", (t, parts) => {
    const st = table(t);
    for (const p of parts) expect(st, p).toContain(p);
    expect(st).toContain("DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  });
  it("no foreign keys, only CREATE TABLE IF NOT EXISTS", () => {
    const st = splitSql(sql);
    expect(st).toHaveLength(5);
    for (const s of st) { expect(s).toMatch(/^CREATE TABLE IF NOT EXISTS/); expect(s).not.toMatch(/FOREIGN KEY|REFERENCES/i); }
  });
});
