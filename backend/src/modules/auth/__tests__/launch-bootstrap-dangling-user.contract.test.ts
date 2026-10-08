import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * bootstrap-existing-users is the tool that decides whether every employee can log
 * in on day one. If it reports success without creating an account, nobody finds
 * out until the employee tries to sign in.
 *
 * THE DEFECT THIS PINS
 * The handler took employees.user_id at face value:
 *
 *   let userId = emp.user_id ? String(emp.user_id) : null;
 *   ...
 *   if (!userId) { create auth_user }
 *   else { UPDATE auth_user SET must_change_password=1 WHERE id=? }
 *
 * employees.user_id is not guaranteed to reference a live auth_user row. Verified
 * live 2026-08-15: 51 active employees carry a dangling user_id, sharing only TWO
 * distinct values — 5af2cd7b-159e-46e0-ac05-605508347e3f is referenced by 177
 * employee rows in total. Migration residue, not real accounts.
 *
 * For those, the else-branch UPDATE matched zero rows and the run logged them as
 * provisioned. Silent no-op, reported as success.
 *
 * WHY IT MATTERS EVEN THOUGH ONLY 1 ROW REACHES IT TODAY
 * The other 50 are skipped earlier for holding email 'NA'. 389 of 1,327 active
 * employees currently have no usable official email. As HR fills those in — which
 * is the prerequisite for launch — each of those rows stops being skipped and
 * starts reaching this branch. The bug's blast radius grows exactly as the launch
 * proceeds, which is the worst possible time for it to surface.
 *
 * Source-text assertions, matching the convention used for large inline Express
 * handlers elsewhere in this repo.
 */
const SRC = readFileSync(resolve(__dirname, "../auth-launch.routes.ts"), "utf8");

describe("launch bootstrap — a dangling employees.user_id must not be trusted", () => {
  it("verifies the referenced auth_user exists before reusing the id", () => {
    // The lookup must key on the ID, not just the email — the email lookup already
    // existed and did not protect this path.
    expect(SRC).toMatch(/SELECT id FROM auth_user WHERE id=\?\s*LIMIT 1/);
  });

  it("no longer assigns userId straight from the employee column", () => {
    // The exact shape of the bug. If this reappears, the silent no-op is back.
    expect(SRC).not.toMatch(/let userId\s*=\s*emp\.user_id\s*\?\s*String\(emp\.user_id\)\s*:\s*null/);
  });

  it("starts from null so an unverified id falls through to creation", () => {
    expect(SRC).toMatch(/let userId:\s*string \| null = null/);
  });

  it("only adopts the employee's user_id when the row was actually found", () => {
    expect(SRC).toMatch(/if \(linked\[0\]\?\.id\) userId = String\(emp\.user_id\)/);
  });

  it("still falls back to matching an existing account by email", () => {
    // The pre-existing behaviour must survive the fix: an employee whose account
    // exists under their email, but whose user_id was never linked, is adopted
    // rather than duplicated.
    expect(SRC).toMatch(/if \(!userId && existing\[0\]\?\.id\) userId = String\(existing\[0\]\.id\)/);
  });

  it("still repoints employees.user_id after resolving the account", () => {
    // Without this the fix would create an orphan account and leave the employee
    // pointing at the same dead id.
    expect(SRC).toMatch(/UPDATE employees SET user_id=\? WHERE id=\?/);
  });

  it("documents why the column cannot be trusted, with the live evidence", () => {
    expect(SRC).toMatch(/dangling user_id/i);
    expect(SRC).toMatch(/5af2cd7b-159e-46e0-ac05-605508347e3f/);
  });
});
