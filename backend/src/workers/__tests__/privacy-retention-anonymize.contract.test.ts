/**
 * DPDP subject-erasure must actually erase.
 *
 * Two defects this locks down, both measured against live mas_hrms on 2026-08-10:
 *
 *   1. `ats_candidate.mobile` is NOT NULL and the handler set it to NULL. STRICT_TRANS_TABLES
 *      is enabled globally and per-session, so that raises ER_BAD_NULL_ERROR and the entire
 *      UPDATE aborts — no column is erased. Evidence it had never run: 0 rows with
 *      full_name = 'ANONYMIZED', against 1 pending data_rights_request.
 *
 *   2. The handler cleared masks and hashes while leaving the raw identifiers behind:
 *      aadhar_number (28,764 populated), bank_account_no (31,191), bank_ifsc (31,177),
 *      father_name (32,078), uan_number (12,364).
 *
 * These read the statement rather than executing it: the worker resolves holds, walks retention
 * policies and commits per entity, so asserting the SQL shape proves more about the guarantee
 * than standing up that machinery would.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../privacy-retention.worker.ts"), "utf8");

/** The ats_candidate UPDATE only, with comments stripped so prose cannot satisfy an assertion. */
const handlerSql = (() => {
  const body = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const start = body.indexOf("UPDATE ats_candidate");
  expect(start, "ats_candidate anonymize handler not found").toBeGreaterThan(-1);
  return body.slice(start, body.indexOf("WHERE id = ?", start));
})();

/** Columns the handler assigns, as a lookup of column -> assigned expression. */
const assignments = (() => {
  const map = new Map<string, string>();
  for (const m of handlerSql.matchAll(/(\w+)\s*=\s*('[^']*'|NULL|NOW\(\))/gi)) {
    map.set(m[1].toLowerCase(), m[2].toUpperCase());
  }
  return map;
})();

describe("DPDP erasure — ats_candidate anonymize handler", () => {
  it("never assigns NULL to a NOT NULL column, which aborts the whole statement", () => {
    // Verified NOT NULL on the live schema. Assigning NULL here erases nothing at all.
    for (const notNullColumn of ["mobile", "full_name"]) {
      expect(
        assignments.get(notNullColumn),
        `${notNullColumn} is NOT NULL — assigning NULL raises ER_BAD_NULL_ERROR and aborts the erasure`,
      ).not.toBe("NULL");
    }
  });

  it("still marks the record as anonymised", () => {
    expect(assignments.get("full_name")).toBe("'ANONYMIZED'");
  });

  it("erases every raw identifier, not just its mask and hash", () => {
    for (const column of [
      "aadhar_number",
      "pan_number",
      "bank_account_no",
      "bank_account_no_encrypted",
      "bank_ifsc",
      "uan_number",
      "father_name",
      "date_of_birth",
      "email",
    ]) {
      expect(assignments.get(column), `${column} is not erased`).toBe("NULL");
    }
  });

  it("erases every address column, not only the one named `address`", () => {
    // `address` was cleared while current_address and permanent_address were left populated.
    for (const column of ["address", "current_address", "permanent_address"]) {
      expect(assignments.get(column), `${column} is not erased`).toBe("NULL");
    }
  });

  /**
   * The generalisable rule. Clearing `x_masked` / `x_hash` while leaving `x` is precisely the
   * defect that shipped, so assert the relationship rather than today's column list — a new
   * masked column added later cannot reintroduce it unnoticed.
   */
  it("whenever a derived copy is cleared, the column it derives from is cleared too", () => {
    const derived = [...assignments.keys()].filter((c) => /_masked$|_hash$|_encrypted$/.test(c));
    expect(derived.length, "no derived columns found — parser likely broken").toBeGreaterThan(0);
    for (const d of derived) {
      const base = d.replace(/_masked$|_hash$|_encrypted$/, "");
      expect(
        assignments.has(base),
        `${d} is cleared but its source column ${base} is not — the original survives erasure`,
      ).toBe(true);
    }
  });

  it("does not erase the recruiter's own contact details", () => {
    // These identify staff, not the data subject. Clearing them would damage unrelated records.
    for (const column of ["recruiter_email", "recruiter_mobile"]) {
      expect(assignments.has(column), `${column} must not be cleared by subject erasure`).toBe(false);
    }
  });
});
