/**
 * The BGV report endpoint must only query columns that exist.
 *
 * `/report/full` is the sole data source for the BGV report PDF. It issues nine
 * queries inside a single `Promise.all`, so ONE bad column rejects the whole
 * thing and the endpoint 500s — there is no partial result and no fallback.
 *
 * It was ordering qualifications by `year_of_passing`, which is not a column on
 * `candidate_onboarding_qualification` (the column is `passed_out_year`). Every
 * call therefore failed with ER_BAD_FIELD_ERROR, which means the BGV report PDF
 * had never once downloaded successfully for any candidate.
 *
 * Verified against the live production schema, not a migration file:
 *   id, candidate_id, qualification, specialization_course_name,
 *   passed_out_year, passed_out_state, passed_out_city, passed_out_percentage,
 *   document_id, created_at, updated_at, institution_name, roll_number,
 *   board_type
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/bgv-verification.routes.ts"),
  "utf8",
);

/** Confirmed present on candidate_onboarding_qualification in production. */
const REAL_QUALIFICATION_COLUMNS = [
  "id", "candidate_id", "qualification", "specialization_course_name",
  "passed_out_year", "passed_out_state", "passed_out_city",
  "passed_out_percentage", "document_id", "created_at", "updated_at",
  "institution_name", "roll_number", "board_type",
];

/** Names the report code has reached for that the table does not have. */
const ABSENT_QUALIFICATION_COLUMNS = [
  "year_of_passing", "degree_type", "board_university", "field_of_study",
  "marks_percentage", "marks_cgpa",
];

describe("/report/full qualification query", () => {
  const statement = (() => {
    const at = SOURCE.indexOf("FROM candidate_onboarding_qualification");
    expect(at, "the qualifications query has moved or been removed").toBeGreaterThan(-1);
    return SOURCE.slice(at, SOURCE.indexOf("`", at));
  })();

  it("orders by a column that exists", () => {
    const orderBy = statement.match(/ORDER BY\s+([a-z_]+)/i)?.[1];
    expect(orderBy, "no ORDER BY found in the qualifications query").toBeTruthy();
    expect(
      REAL_QUALIFICATION_COLUMNS,
      `ORDER BY ${orderBy} — not a column on candidate_onboarding_qualification. ` +
        "Every /report/full call rejects inside Promise.all and the PDF never downloads.",
    ).toContain(orderBy);
  });

  for (const column of ABSENT_QUALIFICATION_COLUMNS) {
    it(`does not reference ${column}, which the table does not have`, () => {
      expect(statement).not.toMatch(new RegExp(`\\b${column}\\b`));
    });
  }
});

describe("/report/full is all-or-nothing", () => {
  it("still gathers its queries in a single Promise.all", () => {
    // If this ever stops being true the blast radius above changes, and the
    // reasoning in these tests needs revisiting rather than silently holding.
    const at = SOURCE.indexOf("/report/full");
    const body = SOURCE.slice(at, at + 4000);
    expect(body).toContain("await Promise.all([");
  });
});
