/**
 * legacyDb.ts (getLegacyPool) and billDb.ts (getBillPool) both connect to db_bill, an
 * upstream read-only source per the project charter — confirmed by legacyDb.ts's own
 * comment ("All existing code that calls getLegacyPool() is querying db_bill") and its
 * BILL_DB_* credential fallback. Only billDb.ts enforced that at the session level.
 * No code currently writes through getLegacyPool() (confirmed: no INSERT/UPDATE/DELETE
 * against db_bill.* anywhere in the backend), so this closes a defense-in-depth gap
 * rather than a demonstrated violation.
 *
 * Source-text inspection, matching this repo's established contract-test style.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const legacyDbSource = readFileSync(resolve(process.cwd(), "src/db/legacyDb.ts"), "utf8");
const billDbSource = readFileSync(resolve(process.cwd(), "src/db/billDb.ts"), "utf8");

describe("legacyDb.ts enforces the same read-only boundary as its sibling billDb.ts", () => {
  it("billDb.ts sets a read-only session pragma (the established, correct pattern)", () => {
    expect(billDbSource).toContain("SET SESSION TRANSACTION READ ONLY");
  });

  it("legacyDb.ts sets the same read-only session pragma", () => {
    expect(legacyDbSource).toContain("SET SESSION TRANSACTION READ ONLY");
  });

  it("legacyDb.ts sets it inside getLegacyPool, on first connection", () => {
    const fn = legacyDbSource.match(/export async function getLegacyPool\(\)[\s\S]*?\n\}/);
    expect(fn, "getLegacyPool function body not found").toBeTruthy();
    expect(fn![0]).toContain("SET SESSION TRANSACTION READ ONLY");
  });
});
