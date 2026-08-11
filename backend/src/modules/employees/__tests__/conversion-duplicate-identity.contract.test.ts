/**
 * Converting a candidate who is ALREADY an active employee must be blocked.
 *
 * On 2026-08-05 the ATS raised employee MAS63086 — a fresh `preboarding` record
 * with a full joining kit and e-sign chase — for a person already working under
 * MAS62457, whose attendance runs 2026-05-08 to 2026-08-06 and who logged into
 * HRMS on 2026-08-04. One human, three employees rows. It also misrouted 29
 * internal HR escalations, because the live record holds an `hr` role and the
 * duplicate shares her personal Gmail.
 *
 * Rule 10 was supposed to prevent exactly this and did not, for two reasons this
 * file locks down:
 *
 *   1. It matched employee_statutory_info ALONE. Measured against live
 *      mas_hrms on 2026-08-08: 33,436 rows in that table, but only 36 of the
 *      1,125 active employees join to one carrying a PAN — 3.2%. The populated
 *      source is the employees table itself: PAN on 915 (81%), Aadhaar on 1,043
 *      (93%).
 *   2. Aadhaar was format-checked but never duplicate-checked, and Aadhaar is
 *      the better key of the two.
 *
 * These assert the SQL shape rather than execute it: the orchestrator opens a
 * pooled transaction and reaches BGV, consent, provisioning and LMS, so standing
 * it up in a unit test proves less about this guard than reading it does.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(__dirname, "../employee-creation-orchestrator.service.ts"),
  "utf8",
);

/** Source with comments removed, for assertions that must not match prose. */
const codeOnly = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("candidate to employee conversion — duplicate identity guard", () => {
  it("checks the employees table, not only employee_statutory_info", () => {
    // The 3.2%-coverage bug: statutory_info as the sole source.
    expect(source).toMatch(/FROM employees e\s+LEFT JOIN employee_statutory_info/);
    expect(source).toContain("e.pan_number");
    expect(source).toContain("e.aadhaar_number");
  });

  it("blocks on duplicate Aadhaar, which previously had no duplicate check", () => {
    expect(source).toContain("duplicate_aadhaar");
    expect(source).toMatch(/findActiveEmployeeByStatutoryId\(conn, 'aadhaar'/);
  });

  it("still blocks on duplicate PAN", () => {
    expect(source).toContain("duplicate_pan");
    expect(source).toMatch(/findActiveEmployeeByStatutoryId\(conn, 'pan'/);
  });

  it("both duplicate blockers are critical, so they actually stop the conversion", () => {
    for (const kind of ["duplicate_pan", "duplicate_aadhaar"]) {
      const at = source.indexOf(`type: '${kind}'`);
      expect(at, `${kind} blocker missing`).toBeGreaterThan(-1);
      // severity sits a few lines below type in each blocker literal
      expect(source.slice(at, at + 600)).toContain("severity: 'critical'");
    }
  });

  it("keys on active_status = 1 so a genuine rehire is NOT blocked", () => {
    // A resigned or previously-onboarding record is active_status = 0. Without
    // this the guard would refuse every legitimate rehire, and would also block
    // a half-finished conversion from being retried.
    expect(source).toMatch(/WHERE e\.active_status = 1/);
  });

  it("never keys on pan_blind_index, which is empty on every active employee", () => {
    // Present in the schema, populated on 0 of 1,125 — keying the LOOKUP on it would
    // match nothing and silently reinstate the hole. Comments are stripped first: the
    // column is named in prose precisely to explain why it is not a lookup key, and
    // that mention must not read as usage.
    //
    // Scoped to findActiveEmployeeByStatutoryId rather than the whole file, because the
    // orchestrator now WRITES pan_blind_index when it inserts employee_statutory_info —
    // which is how the column stops being empty in the first place. Writing it is
    // required; reading it as a lookup key while it is empty is the defect. A file-wide
    // assertion cannot tell those two apart, and as written it blocked the very fix that
    // will eventually make keying on it viable. The write itself is pinned separately, by
    // "employee_statutory_info writers keep the PAN dual-write" in
    // src/shared/__tests__/syncPiiEncryption.test.ts.
    const start = codeOnly.indexOf("async function findActiveEmployeeByStatutoryId");
    expect(start, "duplicate lookup function missing").toBeGreaterThan(-1);
    const rest = codeOnly.slice(start + 1);
    const nextFn = rest.search(/^(?:async )?function /m);
    const lookup = nextFn === -1 ? rest : rest.slice(0, nextFn);

    expect(lookup).not.toContain("pan_blind_index");
    expect(lookup).not.toContain("blindIndex");
  });

  it("uses employee_statutory_info's real Aadhaar column name", () => {
    // The two tables disagree: employees.aadhaar_number vs
    // employee_statutory_info.aadhaar_id. Guessing throws ER_BAD_FIELD_ERROR on
    // every conversion.
    expect(source).toContain("s.aadhaar_id");
    expect(source).not.toContain("s.aadhaar_number");
  });

  it("does not fail open when the duplicate lookup errors", () => {
    // The original guard's failure mode was passing everything. A thrown query
    // must fall back to the employees table, not to "no duplicate found".
    const guard = codeOnly.slice(codeOnly.indexOf("async function findActiveEmployeeByStatutoryId"));
    expect(guard).toContain("catch");
    // The catch must still run a lookup, not return null.
    expect(guard).toMatch(/catch\s*\([\s\S]*?FROM employees/);
    expect(guard).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*return null/);
  });

  it("leaves rule 7 alone — mobile and email still do not block", () => {
    expect(source).toContain("7. No duplicate mobile/email blocking");
  });
});
