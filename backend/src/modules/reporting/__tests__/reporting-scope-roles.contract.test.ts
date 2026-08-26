import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Who sees the whole organisation in reports.
 *
 * SUPER_ADMIN_ROLES was ['super_admin','admin','ceo'], so a COO would have been restricted to
 * their own branch by the `emp?.branch_id` fallback — the opposite of the intent, and
 * inconsistent with SENSITIVE_ROLES in the same module, which already listed coo.
 *
 * No coo users existed when this was written (verified live 2026-08-26), so the defect was
 * latent: it would appear the first time the role was granted.
 */
const SRC = readFileSync(resolve(process.cwd(), "src/modules/reporting/reporting.scope.ts"), "utf8");
const roleList = () => /const SUPER_ADMIN_ROLES\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";

describe("reporting scope roles", () => {
  it("grants org-wide scope to super_admin, admin, ceo and coo", () => {
    for (const role of ["super_admin", "admin", "ceo", "coo"]) {
      expect(roleList(), `${role} must have org-wide report scope`).toContain(`'${role}'`);
    }
  });

  it("does not quietly grant org-wide scope to branch or functional roles", () => {
    // branch_admin in this system also carries admin and finance_head grants, so org-wide
    // access must stay an explicit allow-list rather than being inferred.
    for (const role of ["branch_admin", "branch_head", "hr", "operations_manager"]) {
      expect(roleList(), `${role} must NOT be org-wide`).not.toContain(`'${role}'`);
    }
  });

  it("still fails closed for a user with no scope row and no branch", () => {
    expect(SRC).toContain("NO_BRANCH_SCOPE_SENTINEL");
  });
});
