import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

// Migration 2148 (final integration): the follow-up row remembers the shortlist decision it was enrolled from, and shortlist runs
// say what started them (manual, evening, arrival) with one evening run per requisition x source x IST day.
const FILE = "2148_followup_shortlist_link.sql";
const sqlPath = path.resolve(__dirname, "../../../sql/migrations", FILE);
const manifest = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";
const code = splitSql(sql).filter((s) => s.trim());

describe("migration 2148 follow-up shortlist link", () => {
  it("is registered right after 2147", () => {
    const entries = [...manifest.matchAll(/^\s*"(migrations\/[^"]+\.sql)",/gm)].map((m) => m[1]);
    expect(entries.indexOf(`migrations/${FILE}`)).toBe(entries.indexOf("migrations/2147_shortlist_decisions.sql") + 1);
  });
  it("adds the columns and the evening key, every ALTER guarded through information_schema", () => {
    for (const c of [
      "ALTER TABLE qualified_followup ADD COLUMN shortlist_id BIGINT UNSIGNED NULL",
      "ALTER TABLE qualified_followup ADD COLUMN criteria_version_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL",
      "ALTER TABLE shortlist_run ADD COLUMN trigger_kind VARCHAR(10) NOT NULL DEFAULT 'manual'",
      "ALTER TABLE shortlist_run ADD COLUMN evening_date DATE NULL",
      "ALTER TABLE shortlist_run ADD UNIQUE KEY uq_slr_evening (requisition_id, source_kind, evening_date)",
    ]) expect(sql).toContain(c);
    const alters = code.filter((s) => /ALTER TABLE/.test(s));
    expect(alters.length).toBe(5);
    for (const s of alters) expect(s).toMatch(/^\s*SET @s = IF\(\(SELECT COUNT\(\*\) FROM information_schema\.TABLES/);
  });
  it("no IF NOT EXISTS on columns or indexes, no foreign keys", () => {
    expect(code.join("\n")).not.toMatch(/ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|FOREIGN KEY|REFERENCES/i);
  });
});
