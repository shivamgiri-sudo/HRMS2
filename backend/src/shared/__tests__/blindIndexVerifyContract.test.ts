/**
 * The blind-index backfill's own verify must compare like with like.
 *
 * Run against production it reported MISMATCH on a run that was actually perfect:
 *   distinct_plain=13653  distinct_index=13744  still_null=0
 *
 * The index was complete and collision-free. The check was wrong. It compared
 * COUNT(DISTINCT TRIM(pan_number)), which MySQL evaluates under a case-INSENSITIVE
 * collation, against COUNT(DISTINCT pan_blind_index), an HMAC that is inherently
 * case-SENSITIVE. Measured live: distinct under BINARY is 13,744 — exactly the index count.
 * So 91 PAN values differ only in case, and the two counts can never agree by construction.
 *
 * That matters twice over. A false MISMATCH on a correct run trains everyone to ignore the
 * next one — and its message actively misdiagnoses ("two different values hashed to one
 * index"), when more index values than plaintext values is the opposite of a collision.
 *
 * The 91 are also a REAL trap, which is why the fix reports them rather than hiding them:
 * the duplicate guard currently matches plaintext by equality under a case-insensitive
 * collation, so it catches `abcde1234f` vs `ABCDE1234F`. A case-sensitive blind index does
 * not. Migrating the guard onto this index as-is would silently REGRESS duplicate detection
 * for exactly those values — reopening the MAS63086/MAS62457 hole it was built to close.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "statutory-blind-index-backfill.ts");
const source = fs.readFileSync(SCRIPT, "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("blind-index verify compares like with like", () => {
  it("counts distinct plaintext under BINARY, matching the HMAC's case sensitivity", () => {
    expect(code).toMatch(/COUNT\(DISTINCT\s+BINARY\s+TRIM\([^)]*\)\)\s*AS\s+distinct_plain\b/i);
  });

  it("no longer compares a case-folded distinct count against the index", () => {
    // The exact defect: COUNT(DISTINCT TRIM(col)) with no BINARY, aliased to the value the
    // pass/fail comparison uses. The (?!_) matters — distinct_plain_ci is deliberately
    // case-folded, because it is what makes the case-variant count computable.
    expect(code).not.toMatch(/COUNT\(DISTINCT\s+TRIM\([^)]*\)\)\s*AS\s+distinct_plain(?!_)/i);
  });

  it("still reports rows the run failed to index", () => {
    // still_null is the check that actually catches a missed row; it must survive.
    expect(code).toMatch(/still_null/);
  });

  it("surfaces case-variant values instead of hiding them", () => {
    // The 91 are a real migration hazard for the duplicate guard, so the run has to say so.
    expect(code).toMatch(/case_variant|caseVariant/i);
  });

  it("keeps warning against migrating the duplicate guard prematurely", () => {
    expect(source).toMatch(/Do NOT migrate the duplicate guard/i);
  });
});
