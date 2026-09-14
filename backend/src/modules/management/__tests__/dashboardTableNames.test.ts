/**
 * Management dashboard tiles must query tables that exist.
 *
 * These counters are each wrapped in `.catch(() => [[{ count: 0 }]])`, so a
 * query against a non-existent table or column does not fail — it silently
 * reports zero. A tile that has never once looked at the data reads exactly
 * like a tile reporting good news.
 *
 * The expired-documents tile was doing that: it queried `employee_document`
 * (singular, does not exist) and filtered on `active_status` (not a column on
 * the real table), while `employee_documents` holds 207,616 rows.
 *
 * Verified against the live schema, not assumed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/management/management.service.ts"),
  "utf8",
);

/** Confirmed absent from the database. */
const NON_EXISTENT_TABLES = ["employee_document", "shift_master"];

describe("management dashboard queries", () => {
  for (const table of NON_EXISTENT_TABLES) {
    it(`does not query ${table}, which does not exist`, () => {
      // \b so employee_document does not match employee_documents.
      const pattern = new RegExp(`FROM\\s+${table}\\b(?!s)`, "g");
      const hits = SOURCE.match(pattern) ?? [];
      expect(hits.length, `${table} does not exist; the tile silently reports 0`).toBe(0);
    });
  }

  it("counts expired documents from the table that has the rows", () => {
    // The original assertion pinned `FROM employee_documents WHERE expiry_date`.
    // The filter has since moved into the SELECT, because expiry_date is populated
    // on 0 of 207,616 rows and the tile must distinguish "none expired" from "expiry
    // is not tracked" — it now returns NULL when nothing carries an expiry date at
    // all. The intent of this test is unchanged: the right table, and expiry_date
    // actually consulted.
    expect(SOURCE).toMatch(/FROM employee_documents\b/);
    const at = SOURCE.indexOf("FROM employee_documents");
    const statement = SOURCE.slice(SOURCE.lastIndexOf("`", at), SOURCE.indexOf("`", at));
    expect(statement).toContain("expiry_date");
  });

  it("reports expiry as not-tracked rather than zero when no document has one", () => {
    // A hard 0 on a compliance tile reads as an all-clear. Since no document
    // currently carries an expiry date, 0 could only ever mean "not tracked".
    const at = SOURCE.indexOf("FROM employee_documents");
    const statement = SOURCE.slice(SOURCE.lastIndexOf("`", at), SOURCE.indexOf("`", at));
    expect(statement).toMatch(/THEN NULL/);
  });

  it("does not filter employee_documents on a column it does not have", () => {
    // The real table has: id, employee_id, doc_type, doc_category, legacy_source,
    // legacy_ref_id, doc_name, file_url, verified, uploaded_by, created_at,
    // expiry_date, verified_by, verification_date, verification_remarks.
    const at = SOURCE.indexOf("FROM employee_documents");
    const statement = SOURCE.slice(at, SOURCE.indexOf("`", at));
    expect(statement).not.toContain("active_status");
  });
});
