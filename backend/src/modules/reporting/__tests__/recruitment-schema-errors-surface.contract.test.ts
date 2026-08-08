import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const src = readFileSync(resolve(ROOT, "src/modules/reporting/executors/recruitment.executor.ts"), "utf8");

/**
 * The five ATS reports returned a confident zero for a broken query.
 *
 * query() and count() caught ER_NO_SUCH_TABLE, ER_BAD_FIELD_ERROR and ER_PARSE_ERROR and
 * returned [] / 0. Against live mas_hrms every one of them reported "no candidates" while
 * ats_candidate held 37,630 rows, because the SQL names columns the table does not have. The
 * error was logged twice per request and discarded twice.
 *
 * The grid cannot tell that apart from a real empty result, and an empty recruitment pipeline
 * is the most expensive wrong answer this file can give — so the swallow must not come back.
 */
describe("recruitment executor — schema errors must not become empty results", () => {
  /**
   * The error-handling region: the rethrow helper if it exists, otherwise the query/count
   * pair itself. Falling back rather than asserting the anchor exists matters — when the fix
   * is reverted there is no rethrowSchemaError, and an assertion here would abort collection
   * and report "no tests" instead of failing on the swallow that came back.
   */
  const helpers = (() => {
    const start = src.indexOf("function rethrowSchemaError");
    if (start === -1) {
      const qs = src.indexOf("async function query(");
      const ce = src.indexOf("// ----", src.indexOf("async function count("));
      return src.slice(qs === -1 ? 0 : qs, ce === -1 ? src.length : ce);
    }
    const end = src.indexOf("// ----", start);
    return src.slice(start, end === -1 ? src.length : end);
  })();

  it("does not return an empty array or a zero count on a schema error", () => {
    // The exact shape that caused this: `if (SCHEMA_ERRORS.has(code)) return [];`
    expect(helpers).not.toMatch(/catch[\s\S]{0,200}?\breturn\s*\[\s*\]/);
    expect(helpers).not.toMatch(/catch[\s\S]{0,200}?\breturn\s*0\b/);
  });

  it("rethrows every schema error code it recognises", () => {
    for (const code of ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_PARSE_ERROR"]) {
      expect(helpers, `${code} must be handled by rethrowing, not swallowed`).toContain(code);
    }
    expect(helpers).toMatch(/\bthrow\b/);
  });

  it("does not claim the table is missing when only a column is", () => {
    // ats_candidate exists and holds 37,630 rows. Reporting it as an absent table would send
    // whoever reads the error looking for the wrong thing, so ReportSourceUnavailableError —
    // whose message reads "required table X does not exist" — is reserved for ER_NO_SUCH_TABLE.
    const badField = helpers.slice(helpers.indexOf("ER_BAD_FIELD_ERROR"));
    expect(badField).not.toContain("ReportSourceUnavailableError");
    expect(badField).toContain("The table exists");
  });

  it("both helpers route their failures through the rethrow", () => {
    const query = src.slice(src.indexOf("async function query("), src.indexOf("async function count("));
    const count = src.slice(src.indexOf("async function count("));
    expect(query).toContain("rethrowSchemaError");
    expect(count.slice(0, count.indexOf("// ----") + 1 || 800)).toContain("rethrowSchemaError");
  });
});
