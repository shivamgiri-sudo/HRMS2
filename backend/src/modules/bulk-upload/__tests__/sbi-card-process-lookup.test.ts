import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Production regression: migration 1985 merged "SBI Card Collections" onto the real process, "SBI Credit Cards", which took the code SBI_CARD.
 * The uploaders used to look the process up by NAME, found nothing, and every SBI upload failed with "no active process". The dashboard
 * already resolved by code. The batch runner must resolve by code.
 */
describe("SBI batch runner process lookup", () => {
  const src = readFileSync(fileURLToPath(new URL("../sbi-card-batch-runner.ts", import.meta.url)), "utf8");
  it("resolves the process by code SBI_CARD, preferring it over a name match", () => {
    expect(src).toMatch(/process_code = 'SBI_CARD'/);
    expect(src).toMatch(/ORDER BY \(process_code = 'SBI_CARD'\) DESC/);
  });
  it("no longer depends on the name alone", () => {
    expect(src).not.toMatch(/WHERE process_name = \? AND active_status = 1/);
  });
});
