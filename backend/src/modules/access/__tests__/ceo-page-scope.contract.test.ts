/**
 * Role-level page exclusions.
 *
 * COMMON_USER_PAGE_CODES grants a fixed self-service set to every role. That is
 * right for pages every employee has — profile, payslip, resignation — and wrong
 * for self-service pages that only apply to some populations. Until now there was
 * no way to express the difference: getRolePageCodes() unioned the common list with
 * the role list and had no exclusion step, so the only choices were "grant to
 * everyone" or "remove the page from the product".
 *
 * CEO UAT 31-Jul-2026 surfaced this via /my-kpi, which rendered all three KPIs as
 * em-dash, "No data available for this period", Overall Score 0% and a footer
 * reading "3 KPIs Tracked, 0 With Data". The CEO is not measured on operational
 * KPIs, so the page has nothing to show him and should not be offered.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMMON_USER_PAGE_CODES,
  ROLE_EXCLUDED_PAGE_CODES,
  getRolePageCodes,
} from "../../../shared/rbacPageMatrix.js";

describe("role page exclusions", () => {
  it("the CEO no longer receives My KPI", () => {
    expect(getRolePageCodes("ceo")).not.toContain("MY_KPI");
  });

  it("every other role keeps it — they are measured on KPIs", () => {
    // The exclusion must stay surgical. Agents, team leaders, QA and ops staff all
    // have real KPI data and the page is meaningful for them.
    for (const role of ["employee", "team_leader", "qa", "manager", "process_manager", "wfm"]) {
      expect(getRolePageCodes(role), `${role} lost MY_KPI`).toContain("MY_KPI");
    }
  });

  it("excluding one page does not disturb the rest of the CEO's self-service set", () => {
    const ceoPages = getRolePageCodes("ceo");
    for (const code of COMMON_USER_PAGE_CODES) {
      if (code === "MY_KPI") continue;
      expect(ceoPages, `CEO lost ${code}`).toContain(code);
    }
    // And the executive pages are untouched.
    expect(ceoPages).toEqual(
      expect.arrayContaining(["CEO_DASHBOARD", "OPERATIONS_KPI", "REPORTS_CENTER"]),
    );
  });

  it("keeps the exclusion list small and deliberate", () => {
    // This is for pages that are structurally meaningless to a role, not general
    // permission tuning — that belongs in role_page_access.
    const total = Object.values(ROLE_EXCLUDED_PAGE_CODES).reduce((n, list) => n + list.length, 0);
    expect(total).toBeLessThanOrEqual(5);
  });

  it("revokes the database grant too, since /api/access/me reads role_page_access", () => {
    // The code-side union is only half of it: the runtime reads grants from the DB,
    // so a code-only change would leave the page visible.
    const migration = readFileSync(
      resolve(process.cwd(), "sql/1027_ceo_my_kpi_revoke.sql"),
      "utf8",
    );
    expect(migration).toMatch(/UPDATE role_page_access[\s\S]*?can_view\s*=\s*0/);
    expect(migration).toMatch(/role_key\s*=\s*'ceo'/);
    expect(migration).toMatch(/page_code\s*=\s*'MY_KPI'/);
    // Must not touch the other 23 roles that legitimately hold it: every UPDATE
    // has to be constrained by role_key, not by page_code alone.
    const updates = [...migration.matchAll(/UPDATE role_page_access[\s\S]*?;/g)].map((m) => m[0]);
    expect(updates.length).toBeGreaterThan(0);
    for (const stmt of updates) {
      expect(stmt, "an UPDATE not scoped by role_key would revoke MY_KPI for all 24 roles")
        .toMatch(/role_key\s*=\s*'ceo'/);
    }
    expect(migration).not.toMatch(/\bDELETE FROM\b/i);
  });

  it("is manifested, or the revoke can never run", () => {
    expect(readFileSync(resolve(process.cwd(), "src/db/runPendingMigrations.ts"), "utf8"))
      .toContain('"1027_ceo_my_kpi_revoke.sql"');
  });
});
