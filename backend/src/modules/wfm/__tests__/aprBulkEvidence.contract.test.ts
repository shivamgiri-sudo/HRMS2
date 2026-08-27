/**
 * A manual dialler upload must leave evidence, not only a verdict.
 *
 * Much of the dialler estate is not connected to this database, so those campaigns
 * never reach `apr` and their agents are invisible to everything reasoning about
 * dialler coverage — including isEnrolledInAprFeed, which decides whether an
 * Operations Executive is judged on APR alone. The upload wrote only
 * attendance_daily_record, so the engine had no memory the day was ever evidenced:
 * the employee stayed "not covered" and every day the file did not mention kept
 * falling back to their biometric punch.
 *
 * Two properties matter more than the write itself:
 *
 *   1. It cannot double-count. `apr` is keyed (ReportDate, UserID, campaign_id) and
 *      getAprNetMinutes SUMs the rows, so a manual row filed under its own campaign
 *      sits ALONGSIDE a synced one rather than replacing it. Where the feed already
 *      reports a day, no manual evidence row is written.
 *
 *   2. It cannot change what was already correct. The attendance_daily_record write,
 *      its is_locked=1, and its override/regularization precedence are untouched —
 *      the evidence row is added after it, and a failure there degrades to a row
 *      error rather than failing the upload or silently succeeding.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "..", "attendance-apr-bulk.routes.ts"), "utf8");

describe("APR bulk upload records dialler evidence", () => {
  it("writes the uploaded minutes into apr", () => {
    expect(SOURCE).toMatch(/INSERT INTO apr\b/);
    expect(SOURCE).toMatch(/SEC_TO_TIME\(\? \* 60\)/);
  });

  it("files them under their own campaign so a re-upload overwrites", () => {
    expect(SOURCE).toMatch(/MANUAL_UPLOAD_CAMPAIGN\s*=\s*'MANUAL_UPLOAD'/);
    // Whitespace-tolerant: the statement is formatted across lines, and the strict
    // single-line form made this assertion fail on source it should have accepted.
    expect(SOURCE).toMatch(/ON DUPLICATE KEY UPDATE\s+Net_Login = VALUES\(Net_Login\)/);
  });

  it("never adds a second row for a day the feed already reports", () => {
    // getAprNetMinutes SUMs; two rows for one day would double the minutes.
    expect(SOURCE).toMatch(/aprAlreadySynced/);
    expect(SOURCE).toMatch(/campaign_id <> \?/);
  });

  it("does not interpolate CSV values into the lookup SQL", () => {
    // employee_code comes from an uploaded file.
    const at = SOURCE.indexOf("aprAlreadySynced");
    const block = SOURCE.slice(at, at + 900);
    expect(block).toMatch(/'\(\?,\?\)'/);
    expect(block).not.toMatch(/\$\{r\.employee_code\}/);
  });

  it("leaves the attendance write and its protections untouched", () => {
    expect(SOURCE).toMatch(/INSERT INTO attendance_daily_record/);
    // is_locked=1 is what stops the nightly sweep erasing an upload.
    expect(SOURCE).toMatch(/is_locked\s*=\s*IF\(override_by IS NULL AND regularization_id IS NULL, 1,/);
    // The evidence row is written after the verdict, never instead of it.
    expect(SOURCE.indexOf("INSERT INTO attendance_daily_record"))
      .toBeLessThan(SOURCE.indexOf("INSERT INTO apr"));
  });

  it("reports an evidence failure instead of failing the row or hiding it", () => {
    const at = SOURCE.indexOf("INSERT INTO apr");
    const block = SOURCE.slice(at - 400, at + 1200);
    expect(block).toMatch(/catch/);
    expect(block).toMatch(/rowErrors\.push/);
    expect(block).not.toMatch(/catch\s*\{\s*\}/);
  });
});
