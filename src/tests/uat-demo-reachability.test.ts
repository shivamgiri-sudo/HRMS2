/**
 * The UAT pages must be openable on a demo login, not only on a real one.
 *
 * WHY THIS EXISTS
 *   Demo sessions never call GET /api/access/me. useUserRole() short-circuits on a demo
 *   credential and serves a STATIC page list from demoCreds.ts, so everything the backend
 *   does to resolve access — the super_admin all-active-page_catalog rule, role_page_access,
 *   COMMON_USER_PAGE_CODES — is bypassed entirely.
 *
 *   That makes the demo credential its own independent source of truth, and it drifts. The
 *   comment above UAT_FEEDBACK in demoCreds.ts records the first time: the code was added to
 *   COMMON_USER_PAGE_CODES and not to ALL_PAGES, and the page went dark for demo super_admin
 *   because getRolePageCodes("super_admin", ALL_PAGES) returns ALL_PAGES verbatim with no
 *   union. The same thing had happened to the other three UAT codes.
 *
 *   UAT_CHECKLIST_ADMIN is the case that matters most. It is deliberately granted to no role
 *   at all — segregation of duties — so super_admin is the only route in. Missing from
 *   ALL_PAGES, it was reachable by nobody on a demo login, which is the login UAT itself is
 *   most likely to be run from.
 *
 * SCOPE
 *   Asserts reachability, never widens it: UAT_CHECKLIST_ADMIN must still reach super_admin
 *   ONLY, and this file fails if some future change hands it to another role.
 */
import { describe, expect, it } from "vitest";

import { DEMO_CREDENTIALS } from "@/lib/demoCreds";
import { COMMON_USER_PAGE_CODES, getRolePageCodes } from "@/lib/rbacPageMatrix";

/** Every page code gated by a /uat/* route in platform.routes.tsx. */
const UAT_PAGE_CODES = [
  "UAT_FEEDBACK",
  "UAT_TRIAGE_CONSOLE",
  "UAT_RELEASE_BOARD",
  "UAT_CHECKLIST_ADMIN",
] as const;

const pagesFor = (role: string): string[] =>
  DEMO_CREDENTIALS.find((cred) => cred.role === role)?.pages ?? [];

describe("UAT pages are reachable on a demo login", () => {
  it("demo super_admin can open all four UAT pages", () => {
    const pages = pagesFor("super_admin");
    expect(pages.length, "no super_admin demo credential found").toBeGreaterThan(0);

    const missing = UAT_PAGE_CODES.filter((code) => !pages.includes(code));
    expect(
      missing,
      `Missing from the super_admin demo credential: ${missing.join(", ")}. ` +
        `getRolePageCodes("super_admin", ALL_PAGES) returns ALL_PAGES verbatim — it does not ` +
        `union COMMON_USER_PAGE_CODES and it does not consult page_catalog — so a code absent ` +
        `from ALL_PAGES in demoCreds.ts is unreachable on every demo login regardless of what ` +
        `the backend would grant. Add it to ALL_PAGES.`
    ).toEqual([]);
  });

  it("demo admin can open the triage console and release board", () => {
    // These come from the admin matrix list rather than ALL_PAGES, because getRolePageCodes
    // unions ROLE_SPECIFIC_PAGE_CODES for every role except super_admin.
    const pages = getRolePageCodes("admin", []);
    for (const code of ["UAT_TRIAGE_CONSOLE", "UAT_RELEASE_BOARD"]) {
      expect(
        pages,
        `${code} must stay in the admin entry of rbacPageMatrix.ts — admins run UAT triage.`
      ).toContain(code);
    }
  });

  it("every employee can open the feedback form", () => {
    expect(
      COMMON_USER_PAGE_CODES as readonly string[],
      "UAT_FEEDBACK must stay in COMMON_USER_PAGE_CODES — restricting who may report a defect " +
        "is how UAT feedback ends up in a spreadsheet instead of the system."
    ).toContain("UAT_FEEDBACK");
  });

  it("UAT_CHECKLIST_ADMIN stays super_admin-only", () => {
    // Asserting the absence deliberately. Being in the super_admin demo list is reachability;
    // appearing in any OTHER role's list would be a widening of who sees the guardrails.
    const widened = DEMO_CREDENTIALS.filter(
      (cred) => cred.role !== "super_admin" && cred.pages.includes("UAT_CHECKLIST_ADMIN")
    ).map((cred) => cred.role);

    expect(
      widened,
      `UAT_CHECKLIST_ADMIN reached ${widened.join(", ")}. It is granted to no role on purpose: ` +
        `whoever can view the rules that decide whether a change is acceptable should not be ` +
        `the population approving work evaluated under them.`
    ).toEqual([]);
  });
});
