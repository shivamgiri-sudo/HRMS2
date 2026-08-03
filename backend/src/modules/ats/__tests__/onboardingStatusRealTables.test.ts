/**
 * /api/ats/my-onboarding-status must read tables that exist.
 *
 * It queried `ats_onboarding`, which does not exist and never has. The query
 * threw on every request, `.catch(() => [[]])` turned that into "no rows", and
 * the handler reads no rows as "already onboarded" — so it answered every
 * employee with status "completed", percentComplete 100, four of four steps
 * done, whatever their actual state. It also logged ER_NO_SUCH_TABLE on each
 * call, which is how it was noticed.
 *
 * A fallback that reports completion is the worst possible default here: an
 * employee stuck halfway through onboarding is told they are finished.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/ats.routes.ts"),
  "utf8",
);

/** Confirmed absent from mas_hrms. */
const NON_EXISTENT_TABLES = ["ats_onboarding"];

/** Confirmed present, with rows. */
const REAL_TABLES = [
  "ats_onboarding_bridge",
  "candidate_onboarding_profile",
  "candidate_bgv_report",
];

describe("my-onboarding-status", () => {
  const handler = (() => {
    const at = SOURCE.indexOf('"/my-onboarding-status"');
    expect(at, "the route has moved or been removed").toBeGreaterThan(-1);
    return SOURCE.slice(at, SOURCE.indexOf("export default atsRouter", at));
  })();

  for (const table of NON_EXISTENT_TABLES) {
    it(`does not query ${table}, which does not exist`, () => {
      // \b(?!_) so ats_onboarding does not match ats_onboarding_bridge.
      const pattern = new RegExp(`FROM\\s+${table}\\b(?!_)`);
      expect(handler, `${table} does not exist; every call throws and reports completion`)
        .not.toMatch(pattern);
    });
  }

  it("reads the tables that actually hold onboarding state", () => {
    for (const table of REAL_TABLES) {
      expect(handler, `expected the handler to read ${table}`).toContain(table);
    }
  });

  it("treats only a 'clear' BGV as cleared", () => {
    // 'pending' and 'refer' are not cleared. Migration 1070 reset six reports
    // off a fabricated 'clear'; this must not quietly re-award it.
    expect(handler).toMatch(/bgv_status[\s\S]{0,40}===\s*"clear"/);
  });

  it("derives completion from real milestones, not from a missing row", () => {
    for (const flag of ["offerAccepted", "documentsSubmitted", "bgvCleared"]) {
      expect(handler).toContain(flag);
    }
  });
});
