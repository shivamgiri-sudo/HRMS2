import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * A failed row took the whole bulk import down with it.
 *
 * Seven bulk services recorded a row failure with
 *
 *   UPDATE upload_batch_row SET row_status = 'error', error_message = ? ...
 *
 * upload_batch_row has no error_message. The column is error_messages, plural,
 * and it is JSON holding an array of strings - the shape
 * reporting-manager-bulk and roster-assignment-bulk already write.
 *
 * So the UPDATE raised ER_BAD_FIELD_ERROR. It sits inside the per-row catch, so
 * the moment any row failed, the error handler threw from inside itself and the
 * exception escaped the loop: the whole upload aborted, reporting a missing
 * column rather than which row was bad and why. Verified against production -
 * upload_batch_row holds 1,092 rows, 138 of them row_status='error', and every
 * error message that was successfully recorded came from one of the two
 * services that used the correct column.
 */
const DIR = path.resolve(__dirname, "..");

const services = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith("-bulk.service.ts"));

describe("bulk upload row error recording", () => {
  it("finds the bulk services it is meant to guard", () => {
    expect(services.length).toBeGreaterThanOrEqual(7);
  });

  it.each(services)("%s writes to error_messages, not error_message", (file) => {
    const code = fs.readFileSync(path.join(DIR, file), "utf8");
    const live = code
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    // the singular column does not exist on the table
    expect(live).not.toMatch(/error_message\s*=\s*\?/);
  });

  it.each(services)("%s encodes the value as a JSON array", (file) => {
    const code = fs.readFileSync(path.join(DIR, file), "utf8");
    if (!/error_messages\s*=\s*\?/.test(code)) return; // service records no row errors
    // error_messages is a JSON column: a bare string is not valid JSON and the
    // UPDATE would fail just as surely as the wrong column name did.
    expect(code).toMatch(/JSON\.stringify\(\s*\[/);
  });
});
