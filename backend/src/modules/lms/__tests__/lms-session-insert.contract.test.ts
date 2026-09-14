import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * CEO UAT Round 2: /lms/my-learning printed a raw MySQL error onto the CEO's screen —
 * "Field 'session_family_id' doesn't have a default value".
 *
 * portal_sessions lives in the LMS's own database (lms_mcn), a separately deployed system
 * on its own release cycle. Its 20260729100000_secure_browser_sessions migration made
 * session_family_id and absolute_expires_at NOT NULL with no default; this INSERT supplied
 * neither. The failure was invisible for three days because a key-name bug
 * (ctx.access["trainee"], always undefined) returned 403 before execution reached the
 * INSERT. Fixing that surfaced the crash immediately.
 *
 * Two defects, tested separately: the incomplete INSERT, and an error handler that returned
 * the raw driver message to the browser.
 */
describe("LMS portal session contract", () => {
  const routes = read("src/modules/lms/lms.routes.ts");

  /** Comments stripped so negative assertions cannot match the prose explaining them. */
  const code = routes
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("supplies every column the LMS made NOT NULL without a default", () => {
    const insert = code.slice(code.indexOf("INSERT INTO portal_sessions"), code.indexOf("lms_sync_audit_log"));
    for (const column of ["session_family_id", "absolute_expires_at"]) {
      expect(insert, `${column} missing from the INSERT`).toContain(column);
    }
  });

  it("keeps placeholders and bound values in step", () => {
    const insert = code.slice(code.indexOf("INSERT INTO portal_sessions"), code.indexOf("lms_sync_audit_log"));
    const columnList = insert.slice(insert.indexOf("(") + 1, insert.indexOf(")"));
    const columns = columnList.split(",").map((c) => c.trim()).filter(Boolean);
    const values = insert.slice(insert.indexOf("VALUES ("));
    const placeholders = (values.slice(0, values.indexOf(")")).match(/\?/g) ?? []).length;
    // created_at is supplied as NOW(), so it takes a column slot but no placeholder.
    expect(placeholders).toBe(columns.length - 1);
  });

  it("follows the LMS's own backfill convention for the new columns", () => {
    // Their migration backfills session_family_id = id and absolute_expires_at = expires_at,
    // and a CHECK requires absolute_expires_at >= expires_at.
    const insert = code.slice(code.indexOf("INSERT INTO portal_sessions"), code.indexOf("lms_sync_audit_log"));
    expect(insert).toContain("[sessionId, sessionId,");
    expect(insert).toContain("expiresAt, expiresAt]");
  });

  it("refuses a user_type the LMS check constraint would reject", () => {
    // LMS_SESSION_ROUTES carries a 'management' persona; chk_portal_session_user_type
    // allows only trainee/coordinator/admin. Fail readably, not as a constraint violation.
    expect(code).toContain("LMS_PORTAL_SESSION_USER_TYPES");
    expect(code).toMatch(/LMS_PORTAL_SESSION_USER_TYPES[\s\S]{0,120}"trainee", "coordinator", "admin"/);
    expect(code).toContain("!LMS_PORTAL_SESSION_USER_TYPES.includes(identity.userType)");
  });

  it("never returns a raw driver message to the browser", () => {
    // hrmsApi.ts prefers payload.error over payload.message, so anything placed in `error`
    // or `_details` is what the user reads.
    expect(code).not.toContain("error: message,");
    expect(code).not.toContain("_details: msg");
    // The detail must still be logged.
    expect(code).toContain("console.error(\"[lms/launch-context]");
  });
});
