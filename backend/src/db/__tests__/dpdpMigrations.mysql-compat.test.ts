import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitSql } from "../runPendingMigrations.js";

const migrationFiles = [
  "511_wfm_session_call_id.sql",
  "513_dpdp_withdrawal_consolidation.sql",
  "515_employee_pii_encryption_columns.sql",
];

function readMigration(filename: string) {
  return readFileSync(new URL(`../../../sql/${filename}`, import.meta.url), "utf8");
}

describe("DPDP hardening migrations", () => {
  it.each(migrationFiles)("%s uses MySQL-compatible idempotency guards", (filename) => {
    const sql = readMigration(filename);

    expect(sql).not.toMatch(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/i);
    expect(sql).toMatch(/INFORMATION_SCHEMA\.(?:COLUMNS|STATISTICS)/i);
    expect(sql).toMatch(/PREPARE\s+stmt\s+FROM/i);
    expect(splitSql(sql).length).toBeGreaterThan(0);
  });

  it.each(migrationFiles)("%s remains additive and non-destructive", (filename) => {
    const sql = readMigration(filename);

    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/i);
  });
});
