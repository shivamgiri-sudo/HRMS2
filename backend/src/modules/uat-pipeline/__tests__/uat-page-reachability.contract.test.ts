/**
 * Every UAT page code must have a runtime path that actually resolves it.
 *
 * WHY THIS EXISTS
 *   Listing a page in rbacPageMatrix.ts does not grant it. getUserPageAccess() in
 *   modules/access/access.service.ts resolves a user's pages from exactly two sources:
 *     - super_admin  -> every ACTIVE page_catalog row
 *     - anyone else  -> their role_page_access rows, plus COMMON_USER_PAGE_CODES
 *   The matrix is the source a script projects into role_page_access; it is never read at
 *   request time for role grants.
 *
 *   So a page can be built, tested, routed, seeded into page_catalog AND listed in the matrix
 *   and still be openable by nobody. That is what happened here: on 2026-08-08 the live
 *   role_page_access table held 0 rows for any UAT page while admin held 48 rows for others,
 *   so UAT_TRIAGE_CONSOLE and UAT_RELEASE_BOARD would have shipped unreachable by the admins
 *   meant to run them. 1111_uat_admin_page_grants.sql seeds those two rows.
 *
 *   The gap is invisible in every other test because each individual piece is present. This
 *   asserts the pieces JOIN UP.
 *
 * WHY IT READS FILES RATHER THAN THE DATABASE
 *   CI has no database, and the question is about what ships, not what one server currently
 *   holds. A missing seed is a repository defect; the live table is downstream of it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMON_USER_PAGE_CODES } from "../../../shared/rbacPageMatrix.js";

const BACKEND = resolve(__dirname, "../../../..");
const GRANT_SQL = "1111_uat_admin_page_grants.sql";

const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

/**
 * Executable SQL only — `--` comment lines removed.
 *
 * Not cosmetic. The first version of this file matched raw file text, and the migration's own
 * commentary explains why it does NOT grant UAT_CHECKLIST_ADMIN and why it avoids
 * ON DUPLICATE KEY UPDATE. Both assertions therefore failed on the prose describing the very
 * property they were checking. A guard that reads comments as code reports the opposite of
 * the truth.
 */
const executableSql = (rel: string) =>
  read(rel)
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");

/** The four page codes the UAT platform ships. */
const UAT_PAGE_CODES = [
  "UAT_FEEDBACK",
  "UAT_TRIAGE_CONSOLE",
  "UAT_CHECKLIST_ADMIN",
  "UAT_RELEASE_BOARD",
] as const;

describe("every UAT page has a runtime path that resolves it", () => {
  const catalogSql = read("sql/1095_uat_feedback_intake.sql");
  const grantSql = executableSql(`sql/${GRANT_SQL}`);

  it("all four page codes are seeded into page_catalog", () => {
    // Without an ACTIVE catalog row, even the super_admin all-pages rule yields nothing.
    const missing = UAT_PAGE_CODES.filter((code) => !catalogSql.includes(`'${code}'`));
    expect(
      missing,
      `page_catalog seed missing for: ${missing.join(", ")}. ` +
        `super_admin resolves pages from ACTIVE page_catalog rows, so an unseeded code is ` +
        `invisible to every role including super_admin.`
    ).toEqual([]);
  });

  it("UAT_FEEDBACK reaches ordinary employees through COMMON_USER_PAGE_CODES", () => {
    // This is the one code that needs no grant row: access.service.ts merges the common set
    // for every non-super_admin user. If it were ever removed from that list it would need a
    // grant seed per role instead, and reporters would silently lose the ability to file.
    expect(
      COMMON_USER_PAGE_CODES as readonly string[],
      "UAT_FEEDBACK must stay in COMMON_USER_PAGE_CODES or gain per-role grant seeds — " +
        "otherwise UAT reporters cannot open the form they are meant to file from."
    ).toContain("UAT_FEEDBACK");
  });

  it("the two admin pages have grant rows seeded, not just a matrix entry", () => {
    // The actual defect this file exists for. A matrix entry is documentation until a
    // migration writes role_page_access.
    for (const code of ["UAT_TRIAGE_CONSOLE", "UAT_RELEASE_BOARD"]) {
      expect(
        grantSql.includes(code),
        `${code} is listed in rbacPageMatrix.ts under admin but no migration seeds a ` +
          `role_page_access row for it. rbacPageMatrix.ts is NOT read at runtime for role ` +
          `grants — add the seed to ${GRANT_SQL}. Do not fix this by running ` +
          `apply-rbac-page-matrix.mjs --apply: it deactivates every grant absent from the ` +
          `matrix, of which 132 are live.`
      ).toBe(true);
    }
  });

  it("UAT_CHECKLIST_ADMIN is deliberately left to super_admin only", () => {
    // Asserting the ABSENCE on purpose, so a future "the matrix and the seeds disagree"
    // cleanup cannot quietly widen who sees the guardrails. Whoever can view the rules that
    // decide whether a change is acceptable should not also be the population approving work
    // evaluated under them.
    expect(
      grantSql.includes("UAT_CHECKLIST_ADMIN"),
      "UAT_CHECKLIST_ADMIN must not be granted to a role: it reaches super_admin through " +
        "the all-active-pages rule by design (segregation of duties). If this is being " +
        "changed on purpose, change the comment in rbacPageMatrix.ts too."
    ).toBe(false);
  });

  it("the grant migration is registered in the manifest, or it never runs", () => {
    // A migration file that is not in MIGRATION_MANIFEST is inert. This repo has lost
    // migrations exactly this way.
    expect(read("src/db/runPendingMigrations.ts")).toContain(`"${GRANT_SQL}"`);
  });

  it("the grant migration cannot resurrect a deliberately revoked grant", () => {
    // 1105/1107/1108 exist to RETIRE grants. A seed written with
    // `ON DUPLICATE KEY UPDATE ... active_status = 1` re-activates on every boot, so a
    // revocation made later would be silently undone at the next restart.
    expect(
      /ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(grantSql),
      "Use INSERT IGNORE. ON DUPLICATE KEY UPDATE re-activates the row on every run, which " +
        "would reverse any later revocation each time the backend restarts."
    ).toBe(false);
    expect(/INSERT\s+IGNORE/i.test(grantSql)).toBe(true);
  });
});
