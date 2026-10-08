import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

// Migration 2146 (selection criteria S9): selection_person_fact, the per-person facts cache the preview reads.
const FILE = "2146_selection_person_fact.sql";
const sqlPath = path.resolve(__dirname, "../../../sql/migrations", FILE);
const manifest = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";

describe("migration 2146 selection_person_fact", () => {
  it("exists and is registered right after 2145", () => {
    expect(sql).not.toBe("");
    const entries = [...manifest.matchAll(/^\s*"(migrations\/[^"]+\.sql)",/gm)].map((m) => m[1]);
    const at = entries.indexOf(`migrations/${FILE}`);
    expect(entries[at - 1]).toBe("migrations/2145_requisition_selection_rules.sql");
    for (const e of entries.slice(at + 1)) expect(Number(e.match(/migrations\/(\d+)_/)![1]), e).toBeGreaterThan(2146);
  });
  it("creates the cache table only if missing: one row per person and source kind, indexed for the preview read", () => {
    const st = splitSql(sql);
    expect(st).toHaveLength(1);
    const t = st[0];
    expect(t).toContain("CREATE TABLE IF NOT EXISTS selection_person_fact (");
    for (const s of ["mobile10 CHAR(10) NOT NULL", "source_kind VARCHAR(12) NOT NULL", "sub_source VARCHAR(24) NOT NULL", "facts_json JSON NOT NULL", "facts_hash CHAR(64) NOT NULL",
      "refreshed_at DATETIME NOT NULL", "PRIMARY KEY (mobile10, source_kind)", "KEY idx_spf_source (source_kind, mobile10, sub_source)", "KEY idx_spf_refreshed (source_kind, refreshed_at)",
      "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]) expect(t).toContain(s);
    expect(t).not.toMatch(/FOREIGN KEY|REFERENCES/i);
  });
});
