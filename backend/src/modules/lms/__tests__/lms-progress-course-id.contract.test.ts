/**
 * LMS progress must not be dropped for a trainee who has no batch.
 *
 * syncProgress writes trainee KPIs into lms_learning_progress_snapshot, binding
 * the LMS batch_no into course_id as `t.batch_no ?? null`. course_id is
 * varchar(128) NOT NULL DEFAULT '' — verified against live mas_hrms — so every
 * trainee without a batch was rejected with "Column 'course_id' cannot be null".
 *
 * The sync swallowed it per-row into an errors[] array and reported itself
 * "partial", which is why it ran that way unnoticed. From lms_sync_audit_log for
 * the 2026-08-08 22:09 cycle:
 *
 *     sync_type 'progress'  records_synced 211  errors_count 914  status partial
 *
 * 81% of trainees never reached HRMS. The worker log showed the shape of it —
 * "progress MAS61765: Column 'course_id' cannot be null ... and 913 more errors".
 *
 * '' is the column's own DEFAULT, i.e. the sentinel the schema already uses for
 * "no course", and it keeps uq_lms_prog_emp_course (employee_id, course_id)
 * usable — which the statement's ON DUPLICATE KEY UPDATE depends on.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../lms.sync.service.ts"), "utf8");

/** The binding, reproduced — the service module pulls in the LMS + HRMS pools. */
const courseId = (batchNo: unknown) => String(batchNo ?? "").trim();

describe("progress snapshot course_id binding", () => {
  it("never yields null for a trainee with no batch", () => {
    expect(courseId(null)).toBe("");
    expect(courseId(undefined)).toBe("");
    expect(courseId("")).toBe("");
    expect(courseId("   ")).toBe("");
    for (const v of [null, undefined, "", "  "]) {
      expect(courseId(v), "a NOT NULL column would reject this").not.toBeNull();
    }
  });

  it("passes a real batch through unchanged", () => {
    expect(courseId("BATCH-2026-07")).toBe("BATCH-2026-07");
    expect(courseId(4021)).toBe("4021");
    expect(courseId("  BATCH-9  ")).toBe("BATCH-9");
  });

  it("keeps the unique key usable — one unbatched row per employee", () => {
    // uq_lms_prog_emp_course is (employee_id, course_id). With '' every
    // unbatched trainee collapses to exactly one upsertable row; with NULL the
    // key cannot match at all, which is why the insert failed rather than
    // updating.
    const key = (emp: string, batch: unknown) => `${emp}|${courseId(batch)}`;
    expect(key("emp-1", null)).toBe(key("emp-1", ""));
    expect(key("emp-1", null)).not.toBe(key("emp-2", null));
  });

  it("the service binds course_id through that transform, not `?? null`", () => {
    // Comments are stripped first: the fix is explained in prose directly above
    // the binding, and that explanation necessarily quotes the old broken form.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const start = codeOnly.indexOf("INSERT INTO lms_learning_progress_snapshot");
    const stmt = codeOnly.slice(start, codeOnly.indexOf("sync_type, records_synced", start));

    expect(start, "progress insert not found").toBeGreaterThan(-1);
    expect(stmt).toContain('String(t.batch_no ?? "").trim()');
    expect(stmt, "the null-yielding binding is back").not.toContain("t.batch_no ?? null");
  });
});
