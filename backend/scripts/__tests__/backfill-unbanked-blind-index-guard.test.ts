/**
 * backfill-unbanked-from-dbbill.ts writes account_number_blind_index directly (the same
 * column bank-account-blind-index-backfill.ts populates), but only guarded --apply on
 * isUsingDevEncryptionKey() — never isUsingDevBlindIndexKey(), unlike the dedicated backfill
 * script, which checks both. Run with FIELD_ENCRYPTION_KEY correctly set in production but
 * FIELD_BLIND_INDEX_KEY still on its dev fallback, this would silently write dev-key blind
 * indexes for real rows with no error: a lookup built with the wrong key just returns
 * nothing, so the duplicate check it feeds would pass everything and never detect a real
 * collision — exactly the failure mode the dedicated script's guard exists to prevent.
 *
 * The script executes main() at module scope on import (real DB connections), so this is a
 * source-text check, matching the pattern already used for other scripts/ tests in this repo
 * (e.g. minimum-rest-policy-impact-simulation.test.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "scripts/backfill-unbanked-from-dbbill.ts"), "utf8");

describe("backfill-unbanked-from-dbbill.ts refuses to --apply under either dev key", () => {
  it("imports isUsingDevBlindIndexKey alongside isUsingDevEncryptionKey", () => {
    expect(source).toMatch(/import\s*\{[^}]*isUsingDevBlindIndexKey[^}]*\}\s*from\s*"\.\.\/src\/shared\/fieldEncryption\.js"/);
  });

  it("refuses --apply when the blind-index key is the dev fallback", () => {
    expect(source).toMatch(/if \(APPLY && isUsingDevBlindIndexKey\(\)\)/);
  });

  it("both guards run before any write, and each sets a non-zero exit code", () => {
    const encGuardAt = source.indexOf("isUsingDevEncryptionKey()) {");
    const blindGuardAt = source.indexOf("isUsingDevBlindIndexKey()) {");
    const firstWriteAt = source.indexOf("INSERT INTO employee_bank_detail");
    expect(encGuardAt).toBeGreaterThan(-1);
    expect(blindGuardAt).toBeGreaterThan(encGuardAt);
    expect(blindGuardAt).toBeLessThan(firstWriteAt);
    const blindGuardBlock = source.slice(blindGuardAt, blindGuardAt + 300);
    expect(blindGuardBlock).toMatch(/process\.exitCode = 1/);
  });
});
