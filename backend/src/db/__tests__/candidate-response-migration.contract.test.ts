import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const sql = () => readFileSync(join(ROOT, "sql/migrations/2141_candidate_response.sql"), "utf-8");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("migration 2141 candidate_response ledger", () => {
  it("is registered after 2140", () => {
    const reg = readFileSync(join(ROOT, "src/db/runPendingMigrations.ts"), "utf-8");
    const a = reg.indexOf('"migrations/2141_candidate_response.sql"');
    expect(reg.indexOf('"migrations/2140_walkin_invite.sql"')).toBeGreaterThan(0);
    expect(a).toBeGreaterThan(reg.indexOf('"migrations/2140_walkin_invite.sql"'));
  });

  it("has one row per source event (uq_cr_source) and the read indexes", () => {
    const s = sql();
    expect(s).toContain("UNIQUE KEY uq_cr_source (source_kind, source_ref)");
    for (const k of ["idx_cr_time (occurred_at)", "idx_cr_person (mobile10, occurred_at)", "idx_cr_match (match_id)", "idx_cr_req_time (requisition_id, occurred_at)", "idx_cr_status (status, occurred_at)", "idx_cr_drive (drive_id, answer)"]) {
      expect(s).toContain(`KEY ${k}`);
    }
    expect(s).toContain("raw_text VARCHAR(1000) NULL");
  });

  it("creates both tables with IF NOT EXISTS", () => {
    const s = sql();
    expect(s).toContain("CREATE TABLE IF NOT EXISTS candidate_response");
    expect(s).toContain("CREATE TABLE IF NOT EXISTS inbound_email_cursor");
  });

  it("uses unicode_ci and no foreign keys", () => {
    const s = code(sql());
    expect((s.match(/COLLATE=utf8mb4_unicode_ci/g) ?? []).length).toBe(2);
    expect(s).not.toMatch(/FOREIGN KEY/i);
    expect(s).not.toMatch(/ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS/i);
  });
});
