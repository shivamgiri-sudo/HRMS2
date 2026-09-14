/**
 * The eSign-completed HR notification must name columns that exist.
 *
 * When Luckpay's webhook confirms an employee finished their Aadhaar eSign,
 * finalizeChecklistEsign raises an inbox item for the branch's payroll HR so they
 * know a signed document is waiting to be verified. The recipient lookup selected
 * `u.full_name` from `auth_user`, which is a credentials table and has no such
 * column, so the query threw ER_BAD_FIELD_ERROR on every eSign completion.
 *
 * Nothing looked broken. The eSign itself succeeded, and the surrounding
 * try/catch logged the error as a generic "notification failed", so the only
 * visible symptom was an inbox item that never arrived — the silent-failure shape
 * this codebase keeps producing. Verified against live: the old query errors, the
 * corrected one returns the three payroll_hr recipients that exist.
 *
 * This asserts the column names only. Whether the notification is *delivered* is
 * inboxService's contract, not this query's.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.resolve(__dirname, "../employeeJoiningDocuments.service.ts"),
  "utf8",
);
// Strip comments first: the explanation above the fix names `u.full_name` as the
// thing that was wrong, and a naive scan would read that prose as the bug itself.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** auth_user's real columns, verified against live mas_hrms. */
const AUTH_USER_COLUMNS = [
  "id", "email", "password_hash", "is_blocked", "last_login_at", "created_at",
  "updated_at", "must_change_password", "password_changed_at", "is_read_only",
  "last_login_lat", "last_login_lng", "failed_login_attempts", "locked_until",
  "last_failed_at", "session_version",
];

describe("eSign completion HR notification", () => {
  // Scope to the recipient lookup, so an unrelated auth_user query elsewhere in
  // this 2,000-line file cannot mask a regression here.
  const start = code.indexOf("FROM auth_user u");
  const query = code.slice(code.lastIndexOf("SELECT", start), code.indexOf("LIMIT 3", start));

  it("locates the payroll_hr recipient query", () => {
    expect(start).toBeGreaterThan(-1);
    expect(query).toContain("role_key = 'payroll_hr'");
  });

  it("does not select full_name from auth_user, which has no such column", () => {
    expect(AUTH_USER_COLUMNS).not.toContain("full_name");
    expect(query).not.toContain("u.full_name");
  });

  it("takes the name from the employees join instead", () => {
    expect(query).toContain("JOIN employees e");
    expect(query).toContain("e.full_name");
  });

  it("still selects the identity fields auth_user genuinely has", () => {
    for (const column of ["u.id", "u.email"]) {
      expect(query).toContain(column);
    }
    expect(AUTH_USER_COLUMNS).toEqual(expect.arrayContaining(["id", "email"]));
  });
});
