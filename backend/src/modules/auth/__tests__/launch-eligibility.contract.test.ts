import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyLaunchEmployee,
  resolveLoginEmail,
  summariseLaunchEligibility,
  type LaunchEmployeeRow,
} from "../launch-eligibility.js";

/**
 * TWO defects are pinned here, both measured live against mas_hrms on 2026-08-16
 * over the 1,327 active launch employees.
 *
 * 1. READINESS AND BOOTSTRAP DISAGREED.
 *    GET /launch-readiness counted `e.user_id IS NULL` and `COALESCE(e.email,'')=''`.
 *    POST /bootstrap-existing-users additionally required the auth_user row to
 *    EXIST and the address to contain '@'. Result: 53 employees were reported
 *    launch-ready that the bootstrap provably could not provision — 51 carrying a
 *    dangling user_id (four ghost ids, one referenced by 177 employee rows) and 52
 *    holding the literal string 'NA', which is not blank but is not an email.
 *    Readiness also returned no verdict, so the aggregate could never turn red.
 *
 * 2. PRIVILEGE WAS INFERRED FROM FREE TEXT.
 *    inferRoles() derived HRMS roles from designation+department substrings and
 *    assignRole() wrote them to user_roles with ON DUPLICATE KEY active_status=1.
 *    Simulated over the real population that is 113 NEW privileged grants and 27
 *    revoked grants silently revived. 127 route files gate on one of those roles
 *    with no scope resolver in the file, so each grant is org-wide there.
 */

const ROUTES = readFileSync(resolve(__dirname, "../auth-launch.routes.ts"), "utf8");

const row = (over: Partial<LaunchEmployeeRow> = {}): LaunchEmployeeRow =>
  ({
    id: "emp-1",
    employee_code: "MAS00001",
    first_name: "Asha",
    last_name: "Rao",
    email: "asha@teammas.co.in",
    official_email: null,
    office_email: null,
    user_id: "user-1",
    employment_status: "active",
    auth_user_id: "user-1",
    active_role_count: 1,
    privileged_role_count: 0,
    scope_row_count: 0,
    invite_status: "sent",
    ...over,
  }) as LaunchEmployeeRow;

const index = (pairs: Array<[string, string]> = []) => new Map<string, string>(pairs);

describe("Option C — official email preferred, personal address needs approval", () => {
  it("prefers a company-domain address over a personal one in any column", () => {
    // The live shape: employees.email is the PERSONAL column (851 of 938 gmail),
    // official_email holds the company address. Picking `email` first was wrong.
    const r = resolveLoginEmail({ email: "asha.personal@gmail.com", official_email: "asha@teammas.co.in" });
    expect(r.email).toBe("asha@teammas.co.in");
    expect(r.source).toBe("official_email");
    expect(r.company).toBe(true);
  });

  it("rescues employees whose only usable address is official/office", () => {
    // 286 active employees have no usable `email` but do have an official/office
    // one, and were skipped for nothing.
    const r = resolveLoginEmail({ email: "NA", office_email: "asha@teammas.in" });
    expect(r.email).toBe("asha@teammas.in");
    expect(r.company).toBe(true);
  });

  it("flags a personal-only address instead of silently using it", () => {
    const r = resolveLoginEmail({ email: "asha@gmail.com" });
    expect(r.email).toBe("asha@gmail.com");
    expect(r.company).toBe(false);
  });

  it("separates 'nothing recorded' from 'recorded but unusable'", () => {
    expect(resolveLoginEmail({}).hadUnusableValue).toBe(false);
    expect(resolveLoginEmail({ email: "NA" }).hadUnusableValue).toBe(true);
  });
});

describe("classification — the states readiness used to miss", () => {
  it("reports a dangling user_id rather than counting it as provisioned", () => {
    // The exact 51-employee case. auth_user_id is NULL because the LEFT JOIN
    // found nothing, while employees.user_id is still set.
    const r = classifyLaunchEmployee(
      row({ user_id: "5af2cd7b-159e-46e0-ac05-605508347e3f", auth_user_id: null }),
      index()
    );
    expect(r.state).toBe("DANGLING_USER_ID");
  });

  it("treats the literal 'NA' as INVALID_EMAIL, not as an address", () => {
    const r = classifyLaunchEmployee(row({ email: "NA", official_email: null, office_email: null }), index());
    expect(r.state).toBe("INVALID_EMAIL");
  });

  it("adopts an account that exists under the address but was never linked", () => {
    const r = classifyLaunchEmployee(
      row({ user_id: null, auth_user_id: null, email: "asha@teammas.co.in" }),
      index([["asha@teammas.co.in", "user-9"]])
    );
    expect(r.authUserId).toBe("user-9");
    expect(r.state).not.toBe("NO_AUTH_ACCOUNT");
  });

  it("blocks a privileged role that has no scope row", () => {
    const r = classifyLaunchEmployee(row({ privileged_role_count: 1, scope_row_count: 0 }), index());
    expect(r.state).toBe("SCOPE_UNMAPPED");
  });

  it("does not issue a launch login to a resigned employee", () => {
    const r = classifyLaunchEmployee(row({ employment_status: "resigned" }), index());
    expect(r.state).toBe("BLOCKED");
  });

  it("requires approval before a personal address becomes a login", () => {
    const r = classifyLaunchEmployee(row({ email: "asha@gmail.com", official_email: null }), index());
    expect(r.state).toBe("EMAIL_NEEDS_APPROVAL");

    const approved = classifyLaunchEmployee(
      row({ email: "asha@gmail.com", official_email: null }),
      index(),
      { allowPersonalEmailFallback: true }
    );
    expect(approved.state).toBe("READY");
  });

  it("reports INVITE_NOT_PREPARED — the live state of all 1,327 today", () => {
    // hrms_launch_invite_log is empty in production; nobody has been invited.
    expect(classifyLaunchEmployee(row({ invite_status: null }), index()).state).toBe("INVITE_NOT_PREPARED");
  });
});

describe("the aggregate cannot report green while anyone is blocked", () => {
  it("goes RED on a single blocked employee", () => {
    const rows = [
      classifyLaunchEmployee(row(), index()),
      classifyLaunchEmployee(row({ id: "emp-2", email: "NA", official_email: null }), index()),
    ];
    const summary = summariseLaunchEligibility(rows);
    expect(summary.ready).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.verdict).toBe("RED");
  });

  it("is GREEN only when every employee is READY", () => {
    const summary = summariseLaunchEligibility([classifyLaunchEmployee(row(), index())]);
    expect(summary.verdict).toBe("GREEN");
  });
});

describe("the bootstrap may not grant privilege", () => {
  it("grants only the baseline employee role", () => {
    expect(ROUTES).toMatch(/await assignRole\(userId, "employee", req\.authUser!\.id\)/);
  });

  it("no longer feeds inferred roles into user_roles", () => {
    // The exact shape of the defect: a loop writing every inferred role.
    expect(ROUTES).not.toMatch(/for \(const role of inferRoles\(emp\)\) await assignRole/);
    // The function itself is gone and nothing calls it. (The name still appears
    // in a comment explaining what was removed and why — that is the point.)
    expect(ROUTES).not.toMatch(/function inferRoles\(/);
    expect(ROUTES).not.toMatch(/inferRoles\(emp\)/);
  });

  it("keeps the string matching for KPI templates only, under a name that says so", () => {
    // Removing it outright would break the working KPI assignment; it must simply
    // never reach access control.
    expect(ROUTES).toMatch(/function inferKpiRoleCodes\(/);
    expect(ROUTES).toMatch(/const roleCodes = inferKpiRoleCodes\(emp\)/);
  });

  it("hard-blocks any role outside the allowlist", () => {
    expect(ROUTES).toMatch(/BOOTSTRAP_GRANTABLE_ROLES/);
    expect(ROUTES).toMatch(/may not grant role/);
  });

  it("derives readiness from the shared resolver, not its own SQL", () => {
    expect(ROUTES).toMatch(/summariseLaunchEligibility\(classified\)/);
    // The old optimistic readiness query must be gone.
    expect(ROUTES).not.toMatch(/SUM\(CASE WHEN e\.user_id IS NULL THEN 1 ELSE 0 END\)/);
    expect(ROUTES).not.toMatch(/SUM\(CASE WHEN COALESCE\(e\.email, ''\) = '' THEN 1 ELSE 0 END\)/);
  });
});
