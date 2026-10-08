/**
 * The LMS mapper's cache read must use columns that exist.
 *
 * lms_employee_mapping stores `employee_id` and `lms_learner_id`. getOrMapLmsTrainee
 * asked for `hrms_employee_id` / `lms_employee_id`, so it threw ER_BAD_FIELD_ERROR
 * on every call — proven by running the compiled function against production, not
 * inferred from reading it.
 *
 * It was not visibly failing because the live process is running an older
 * in-memory build. The dist compiled from this source is broken, so the next
 * restart would have taken learner_progress from 911 synced to 0 and turned
 * lms_learner_progress stale — a table five other modules read assuming freshness.
 *
 * This test guards the read only. The upsert and audit writes in the same file
 * are also wrong (hrms_mobile, hrms_personal_email, lms_employee_mapping_audit —
 * none exist), but they sit on the cache-miss path and need columns the table
 * does not have at all, which is a schema decision rather than a rename.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, "../lms-employee-mapper.ts"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Columns that genuinely exist on lms_employee_mapping, verified against live. */
const REAL_COLUMNS = [
  "id", "employee_id", "lms_learner_id", "email", "mapped_at",
  "is_active", "mapping_source", "mapping_confidence", "hrms_employee_code", "mapped_by",
];

describe("lms_employee_mapping cache read", () => {
  const read = code.slice(code.indexOf("async getOrMapLmsTrainee"));
  const body = read.slice(0, read.indexOf("mapLmsTrainee(lmsId)"));

  it("selects a column the table actually has", () => {
    expect(body).toContain("SELECT employee_id FROM lms_employee_mapping");
    expect(REAL_COLUMNS).toContain("employee_id");
  });

  it("filters on the real learner-id column", () => {
    expect(body).toContain("WHERE lms_learner_id = ?");
    expect(REAL_COLUMNS).toContain("lms_learner_id");
  });

  it("reads the result under the same name it selected", () => {
    // Selecting employee_id and then reading row.hrms_employee_id returns
    // undefined -> null, which would look exactly like "no mapping found" and
    // silently disable the cache for all 1,177 rows.
    expect(body).toContain(".employee_id");
    expect(body).not.toContain("hrms_employee_id");
  });

  it("does not reference the non-existent columns anywhere in the read path", () => {
    for (const ghost of ["hrms_employee_id", "lms_employee_id"]) {
      expect(body, `${ghost} does not exist on lms_employee_mapping`).not.toContain(ghost);
    }
  });
});
