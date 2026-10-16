import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

// Migration 2214: cost_centre_process_link. cost_centre_master.process_id is a 1:1 primary link and stays
// untouched (P&L, GRN and budget read it). This side table records the extra processes a cost centre
// also bills (Bella-Vita on IDAM's 647, Reginald on BTM's 972, Housing Owner/Premium on 592, VST on 968).
// Additive: one CREATE TABLE, five seed rows, no FKs, no ALTER of any existing table.
const FILE = "2214_cost_centre_process_link.sql";
const sqlPath = path.resolve(__dirname, "../../../sql/migrations", FILE);
const manifest = fs.readFileSync(path.resolve(__dirname, "../runPendingMigrations.ts"), "utf8");
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, "utf8") : "";
// Comments carry words like ALTER / REFERENCES / DROP (the revert note), so assertions run on code only,
// with whitespace collapsed so column alignment in the file does not matter.
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const statements = splitSql(code).map((s) => s.replace(/\s+/g, " ").trim());

const SEEDS: Array<[string, string]> = [
  ["BELLA_VITA", "BSS/IB/Noida/647"],
  ["REGINALD", "BSS/OB/NOIDA-2/972"],
  ["HOUSING_OWNER", "BSS/OB/Noida/592"],
  ["HOUSING_PREMIUM", "BSS/OB/Noida/592"],
  ["VST", "BSS/OB/Noida/968"],
];

describe("migration 2214 cost_centre_process_link", () => {
  it("file exists and is registered after 2213", () => {
    expect(fs.existsSync(sqlPath)).toBe(true);
    const entries = [...manifest.matchAll(/^\s*"(migrations\/[^"]+\.sql)",/gm)].map((m) => m[1]);
    expect(entries.indexOf(`migrations/${FILE}`)).toBe(
      entries.indexOf("migrations/2213_pnl_classification_rules_agent_roles.sql") + 1,
    );
  });

  it("creates the link table with a unique pair, NULL share_pct and the repo collation", () => {
    const create = statements.find((s) => s.includes("CREATE TABLE IF NOT EXISTS cost_centre_process_link (")) ?? "";
    for (const part of [
      "id CHAR(36) NOT NULL PRIMARY KEY",
      "cost_centre_id CHAR(36) NOT NULL",
      "process_id CHAR(36) NOT NULL",
      "relation VARCHAR(30) NOT NULL DEFAULT 'also_billed_under'",
      "share_pct DECIMAL(5,2) NULL",
      "evidence VARCHAR(500) NULL",
      "active_status TINYINT(1) NOT NULL DEFAULT 1",
      "UNIQUE KEY uq_ccpl_pair (cost_centre_id, process_id)",
      "KEY idx_ccpl_process (process_id, active_status)",
      "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    ]) expect(create, part).toContain(part);
  });

  it("is additive: no FK, no ALTER, no UPDATE/DELETE, nothing outside the new table", () => {
    const noTimestampTrigger = code.replace(/ON UPDATE CURRENT_TIMESTAMP/gi, "");
    expect(noTimestampTrigger).not.toMatch(/FOREIGN KEY|REFERENCES|ALTER\s+TABLE|DROP\s|DELETE\s|UPDATE\s|TRUNCATE/i);
    for (const s of statements) expect(s).toMatch(/^(CREATE TABLE IF NOT EXISTS cost_centre_process_link|INSERT INTO cost_centre_process_link)/);
  });

  it.each(SEEDS)("seeds %s -> %s by code, idempotently", (proc, cc) => {
    const seed = statements.find((s) => s.startsWith("INSERT INTO cost_centre_process_link") && s.includes(`'${proc}'`) && s.includes(`'${cc}'`)) ?? "";
    expect(seed, `${proc}/${cc}`).not.toBe("");
    expect(seed).toMatch(/AND NOT EXISTS \(SELECT 1 FROM cost_centre_process_link/);
    expect(seed).toContain("FROM cost_centre_master");
    expect(seed).toContain("process_master");
  });

  it("seeds exactly five links and never GNC", () => {
    expect(statements.filter((s) => s.startsWith("INSERT INTO cost_centre_process_link"))).toHaveLength(SEEDS.length);
    expect(code).not.toMatch(/'GNC'/);
  });

  it("never invents a revenue split", () => {
    for (const s of statements.filter((x) => x.startsWith("INSERT INTO"))) expect(s).not.toMatch(/share_pct/);
  });
});
