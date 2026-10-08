import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const sql = () => readFileSync(join(ROOT, "sql/migrations/2138_unified_followup.sql"), "utf-8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("migration 2138 unified follow-up journey", () => {
  it("is registered after 2137", () => {
    const reg = readFileSync(join(ROOT, "src/db/runPendingMigrations.ts"), "utf-8");
    const at = reg.indexOf('"migrations/2138_unified_followup.sql"');
    expect(at).toBeGreaterThan(reg.indexOf('"migrations/2137_qualified_followup_call_batch_slot.sql"'));
    expect(reg.indexOf('"migrations/2137_qualified_followup_call_batch_slot.sql"')).toBeGreaterThan(0);
  });

  it("guards every ALTER through information_schema", () => {
    const lines = code(sql()).split("\n").filter((l) => /ALTER TABLE/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(10);
    for (const l of lines) {
      expect(l).toMatch(/^SET @s = IF\(\(SELECT COUNT\(\*\) FROM information_schema\./);
      expect(l).toContain("PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;");
    }
  });

  it("adds the journey columns and indexes to qualified_followup and sent_by to he_message", () => {
    const s = sql();
    for (const c of ["match_id CHAR(36) NULL", "journey_state VARCHAR(20) NOT NULL DEFAULT 'enrolled'", "held_reason VARCHAR(40) NULL", "call_result VARCHAR(40) NULL",
      "reinvite_no TINYINT NOT NULL DEFAULT 0", "missed_call_due_at DATETIME NULL", "stage_a_ended_at DATETIME NULL"]) {
      expect(s).toContain(`ALTER TABLE qualified_followup ADD COLUMN ${c}`);
    }
    expect(s).toContain("ADD INDEX idx_qfu_mode_journey (mode_at_enqueue, journey_state)");
    expect(s).toContain("ADD INDEX idx_qfu_match (match_id)");
    expect(s).toContain("ALTER TABLE he_message ADD COLUMN sent_by VARCHAR(20) NULL");
  });

  it("widens mode_at_enqueue only when canary is missing", () => {
    const s = sql();
    expect(s).toContain("COLUMN_TYPE NOT LIKE '%canary%'");
    expect(s).toContain("MODIFY COLUMN mode_at_enqueue ENUM('dry_run','live','test','canary') NOT NULL");
  });

  it("creates the three tables with IF NOT EXISTS and unicode_ci, no foreign keys", () => {
    const s = code(sql());
    for (const t of ["followup_person", "followup_canary", "followup_shadow"]) expect(s).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    expect((s.match(/COLLATE=utf8mb4_unicode_ci/g) ?? []).length).toBe(3);
    expect(s).toContain("PRIMARY KEY (source_type, requisition_id)");
    expect(s).toContain("KEY idx_fs_person (mobile10, would_at)");
    expect(s).not.toMatch(/FOREIGN KEY/i);
    expect(s).not.toMatch(/ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS/i);
  });

  it("does not add slot_key (2137 owns it)", () => {
    expect(sql()).not.toMatch(/slot_key/);
  });
});
