import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(__dirname, "../../../sql/200_onboarding_empcode_bgv_gaps.sql"), "utf8");

describe("onboarding empcode/BGV gaps migration", () => {
  it("creates candidate onboarding bank details before altering bank validation columns", () => {
    const createTableOffset = migration.search(/CREATE TABLE IF NOT EXISTS candidate_onboarding_bank_detail/i);
    const firstBankAlterOffset = migration.search(/ALTER TABLE candidate_onboarding_bank_detail ADD COLUMN validated_by/i);

    expect(createTableOffset).toBeGreaterThanOrEqual(0);
    expect(firstBankAlterOffset).toBeGreaterThan(createTableOffset);
  });

  it("includes columns used by onboarding and BGV bank-detail writes", () => {
    expect(migration).toMatch(/candidate_id CHAR\(36\) NOT NULL/i);
    expect(migration).toMatch(/account_no_masked VARCHAR\(32\) NULL/i);
    expect(migration).toMatch(/account_no_hash CHAR\(64\) NULL/i);
    expect(migration).toMatch(/account_no_encrypted TEXT NULL/i);
    expect(migration).toMatch(/verification_status VARCHAR\(50\) NOT NULL DEFAULT 'not_started'/i);
    expect(migration).toMatch(/name_validation_status VARCHAR\(50\) NOT NULL DEFAULT 'not_required'/i);
    expect(migration).toMatch(/UNIQUE KEY uq_candidate_bank_detail \(candidate_id\)/i);
  });
});
