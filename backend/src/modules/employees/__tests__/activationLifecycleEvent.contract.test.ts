import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Every activation threw after succeeding.
 *
 * activateEmployee() UPDATEs employees, then writes an employee_lifecycle_event.
 * That INSERT named from_status, to_status and actor_user_id - none of which the
 * table has - and used event_type 'ACTIVATION', which is not a member of its
 * ENUM. Verified against a temporary copy of the real table: the corrected
 * statement is accepted, and 'ACTIVATION' is rejected.
 *
 * There is no transaction around the two statements, so the UPDATE committed and
 * the employee really was activated, while the function threw. The daily job's
 * per-employee catch then counted them as an error rather than as activated, and
 * the "HRMS access created" SMS that follows was never reached.
 * employee_lifecycle_event holds 0 rows, which is the entire history of this
 * feature.
 */
const SERVICE = path.resolve(__dirname, "../employee-activation.service.ts");

/** Source with comment lines removed — this file documents the old columns in
 *  prose, and a guard that matches its own documentation is worthless. */
function liveCode(): string {
  return fs
    .readFileSync(SERVICE, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");
}

describe("activation lifecycle event", () => {
  it("does not name columns the table lacks", () => {
    const code = liveCode();
    for (const col of ["from_status", "to_status", "actor_user_id"]) {
      expect(code, `${col} is not a column of employee_lifecycle_event`).not.toContain(col);
    }
  });

  it("uses the columns the table actually has", () => {
    const code = liveCode();
    for (const col of ["old_value_json", "new_value_json", "initiated_by", "effective_date"]) {
      expect(code).toContain(col);
    }
  });

  it("uses an event_type the ENUM accepts", () => {
    const code = liveCode();
    // the ENUM has no ACTIVATION member; an activation is a status_change
    expect(code).not.toMatch(/'ACTIVATION'/);
    expect(code).toContain("'status_change'");
  });

  it("still records what changed, as JSON", () => {
    // old/new are JSON columns, so the values have to be encoded
    expect(liveCode()).toMatch(/JSON\.stringify\(\s*\{/);
  });
});
