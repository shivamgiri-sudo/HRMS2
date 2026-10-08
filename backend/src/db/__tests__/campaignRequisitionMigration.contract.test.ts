import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

// Migration 2142 (WS3 A1): many requisitions per Meta campaign with one primary (mirrored into meta_campaign.requisition_id),
// how a Live Meta lead was routed (meta_lead_raw.routed_by / routed_at), and the audit of a campaign relink. Pure addition.
const FILE = "2142_campaign_requisition.sql";
const sqlPath = path.resolve(__dirname, "../../../sql/migrations", FILE);
const manifest = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";
const statements = () => splitSql(sql);
const createOf = (table: string) => statements().find((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${table} (`)) ?? "";

describe("migration 2142 campaign requisitions", () => {
  it("exists and is registered exactly once, after 2141", () => {
    expect(sql).not.toBe("");
    const entries = [...manifest.matchAll(/^\s*"(migrations\/[^"]+\.sql)",/gm)].map((m) => m[1]);
    const at = entries.indexOf(`migrations/${FILE}`);
    expect(at).toBeGreaterThan(entries.indexOf("migrations/2141_candidate_response.sql"));
    expect(entries.filter((e) => e.includes("/2142_"))).toHaveLength(1);
  });

  it("creates the link table with the planned key and index, only if missing", () => {
    const t = createOf("meta_campaign_requisition");
    expect(t).toContain("PRIMARY KEY (campaign_id, requisition_id)");
    expect(t).toContain("KEY idx_mcr_req (requisition_id, removed_at)");
    for (const col of ["is_primary TINYINT(1) NOT NULL DEFAULT 0", "sort_order SMALLINT NOT NULL DEFAULT 0", "removed_at DATETIME NULL", "removed_by CHAR(36) NULL", "added_by CHAR(36) NULL"]) {
      expect(t).toContain(col);
    }
  });

  it("backfills the current link as primary, idempotently, skipping the JR-pending marker", () => {
    const b = statements().find((s) => s.includes("INSERT IGNORE INTO meta_campaign_requisition")) ?? "";
    expect(b).toContain("SELECT id, requisition_id, 1");
    expect(b).toMatch(/requisition_id <> ''/);
    expect(b).toMatch(/requisition_id IS NOT NULL/);
  });

  it.each(["routed_by", "routed_at"])("meta_lead_raw.%s is information_schema-guarded", (col) => {
    const st = statements().find((s) => s.includes(`ADD COLUMN ${col} `)) ?? "";
    expect(st).toContain(`TABLE_NAME = 'meta_lead_raw' AND COLUMN_NAME = '${col}') = 0`);
    expect(st).toMatch(/^SET @s = IF\(/);
  });

  it("creates the relink audit table only if missing", () => {
    const t = createOf("meta_campaign_relink");
    for (const col of ["campaign_id CHAR(36) NOT NULL", "from_requisition_id CHAR(36) NULL", "to_requisition_id CHAR(36) NOT NULL", "leads_moved INT NOT NULL", "leads_kept INT NOT NULL", "preview_hash CHAR(64) NOT NULL", "actor_id CHAR(36) NOT NULL", "reason VARCHAR(300) NOT NULL"]) {
      expect(t).toContain(col);
    }
    expect(t).toContain("KEY idx_mcrl_campaign (campaign_id, created_at)");
  });

  it("has no FKs, no IF NOT EXISTS on columns/indexes, and unicode collation on every new table", () => {
    const executable = statements().join("\n");
    expect(executable).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    expect(executable).not.toMatch(/ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS/i);
    for (const t of ["meta_campaign_requisition", "meta_campaign_relink"]) expect(createOf(t)).toContain("DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  });
});
