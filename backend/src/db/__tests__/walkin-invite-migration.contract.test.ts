import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const sql = () => readFileSync(join(ROOT, "sql/migrations/2140_walkin_invite.sql"), "utf-8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("migration 2140 walkin_invite + he_match confirmation stamp", () => {
  it("is registered after 2137", () => {
    const reg = readFileSync(join(ROOT, "src/db/runPendingMigrations.ts"), "utf-8");
    const a = reg.indexOf('"migrations/2140_walkin_invite.sql"');
    expect(a).toBeGreaterThan(reg.indexOf('"migrations/2137_qualified_followup_call_batch_slot.sql"'));
    expect(reg.indexOf('"migrations/2137_qualified_followup_call_batch_slot.sql"')).toBeGreaterThan(0);
  });

  it("creates walkin_invite with a unique token and one invite per mobile+requisition", () => {
    const s = sql();
    expect(s).toContain("CREATE TABLE IF NOT EXISTS walkin_invite");
    expect(s).toContain("UNIQUE KEY uq_wi_token (token)");
    expect(s).toContain("UNIQUE KEY uq_wi_person_req (mobile10, requisition_id)");
    expect(s).toMatch(/state ENUM\('sent','answered_yes','answered_later','declined','stopped','superseded'\) NOT NULL DEFAULT 'sent'/);
  });

  it("adds the three he_match columns through information_schema guards", () => {
    const s = code(sql());
    for (const col of ["confirmed_at", "confirmed_via", "confirmed_response_id"]) {
      expect(s).toMatch(new RegExp(`SET @s = IF\\(\\(SELECT COUNT\\(\\*\\) FROM information_schema\\.COLUMNS[^\\n]*COLUMN_NAME = '${col}'[^\\n]*PREPARE`));
    }
    expect(s).toMatch(/information_schema\.STATISTICS[^\n]*idx_he_match_confirmed[^\n]*\(drive_id, confirmed_at\)/);
    expect(s).not.toMatch(/ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS/i);
  });

  it("uses unicode_ci and no foreign keys", () => {
    const s = code(sql());
    expect(s).toContain("COLLATE=utf8mb4_unicode_ci");
    expect(s).not.toMatch(/FOREIGN KEY/i);
  });
});
