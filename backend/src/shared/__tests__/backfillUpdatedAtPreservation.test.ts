/**
 * A bulk backfill on `employees` must not falsify `updated_at`.
 *
 * employees.updated_at is declared `DEFAULT_GENERATED on update CURRENT_TIMESTAMP`
 * (verified against live schema 2026-08-11), so any UPDATE that does not assign the column
 * its own value stamps every touched row as modified now. Writing a ciphertext mirror or a
 * blind index of a value that already exists is not a business modification of the employee
 * record, and 53,449 falsified "last modified" stamps surface in reports, exports and audit
 * views — and would be indistinguishable from real edits after the fact.
 *
 * employee-pii-encrypt-backfill.mjs got this right and ran clean: updated_in_last_3h = 0
 * across all 58,627 rows despite 53,449 writes. statutory-blind-index-backfill.ts did NOT,
 * and its dry run reports 53,449 rows pending — so it would have falsified exactly the same
 * set. This locks the rule for both, and for whatever bulk writer comes next.
 *
 * Structural, because these scripts refuse to run outside production by design (they check
 * the loaded key first), so there is nothing to execute in a unit test.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

/** Bulk writers that UPDATE employees row by row. */
const BULK_WRITERS = [
  "statutory-blind-index-backfill.ts",
  "employee-pii-encrypt-backfill.mjs",
];

/** Source with comments removed — the rollback recipes in the header are prose, not writes. */
function codeOf(file: string): string {
  return fs.readFileSync(path.join(SCRIPTS, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("bulk backfills preserve employees.updated_at", () => {
  it.each(BULK_WRITERS)("%s exists", (file) => {
    expect(fs.existsSync(path.join(SCRIPTS, file)), `${file} missing`).toBe(true);
  });

  it.each(BULK_WRITERS)("%s assigns updated_at = updated_at on every UPDATE employees", (file) => {
    const code = codeOf(file);
    const statements = code.match(/UPDATE\s+employees\s+SET[\s\S]*?(?=`|;|$)/gi) ?? [];

    expect(statements.length, `no UPDATE employees found in ${file}`).toBeGreaterThan(0);

    for (const stmt of statements) {
      expect(
        /updated_at\s*=\s*updated_at/i.test(stmt),
        `UPDATE employees in ${file} does not preserve updated_at:\n${stmt.trim().slice(0, 240)}`,
      ).toBe(true);
    }
  });

  it("the rollback recipe in each header also preserves updated_at", () => {
    // A rollback that stamps 53,449 rows as modified is the same defect in reverse, and is
    // the instruction someone will paste under time pressure.
    for (const file of BULK_WRITERS) {
      const header = fs.readFileSync(path.join(SCRIPTS, file), "utf8").slice(0, 4000);
      const rollbacks = header.match(/UPDATE\s+employees\s+SET[^\n]*/gi) ?? [];
      for (const line of rollbacks) {
        expect(
          /updated_at\s*=\s*updated_at/i.test(line),
          `rollback recipe in ${file} would falsify updated_at:\n${line.trim()}`,
        ).toBe(true);
      }
    }
  });
});
