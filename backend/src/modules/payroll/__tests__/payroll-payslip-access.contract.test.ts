/**
 * Payslip access: the CEO sees their own payslip, not the organisation's payroll.
 *
 * CEO UAT 31-Jul-2026 (/payroll/payslips, Critical). The reporter saw
 *   "Access denied. Required: admin or hr or finance or payroll"
 * while the full payroll run history — 36+ runs back to 2023 — rendered behind it.
 *
 * That was not a cosmetic UI bug. Three things combined:
 *   1. /payroll/payslips was the only payroll route with no roles= and no <Gate>.
 *   2. PayslipCenterRoute dispatched on `primaryRole === "employee"`, so every
 *      non-employee primary role — CEO, trainer, team leader — got the ADMIN
 *      Payslip Center rather than their own payslip.
 *   3. payroll.secure.routes.ts genuinely authorised `ceo` on /runs and /records,
 *      and allowCeoAllRead resolved the row scope to `1=1`. The data on screen was
 *      real, server-authorised and org-wide. Only the sub-request for line items
 *      (payroll-lines.compat.routes.ts, which never allowed ceo) produced the banner.
 *
 * Policy: payroll is not a management surface. Verified here at the layer that
 * decides it — the role lists — because the suite has no live DB.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const secureRoutes = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll.secure.routes.ts"),
  "utf8",
);
const compatRoutes = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll-lines.compat.routes.ts"),
  "utf8",
);

/** requireRole(...) argument list for a given path in a route file. */
function rolesFor(source: string, path: string): string[] {
  const idx = source.indexOf(`"${path}"`);
  expect(idx, `route ${path} not found`).toBeGreaterThan(-1);
  const window = source.slice(idx, idx + 400);
  const match = window.match(/requireRole\(([^)]*)\)/);
  if (!match) return [];
  return [...match[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("payroll read endpoints exclude the CEO", () => {
  it("does not authorise ceo for org-wide payroll runs", () => {
    const roles = rolesFor(secureRoutes, "/runs");
    expect(roles).not.toContain("ceo");
    // The roles that legitimately run payroll must survive.
    expect(roles).toEqual(expect.arrayContaining(["admin", "hr", "finance", "payroll"]));
  });

  it("does not authorise ceo for employee-level salary records", () => {
    const roles = rolesFor(secureRoutes, "/records");
    expect(roles).not.toContain("ceo");
    expect(roles).toEqual(expect.arrayContaining(["admin", "hr", "finance", "payroll"]));
  });

  it("stops resolving the CEO row scope to the whole organisation for payroll", () => {
    // allowCeoAllRead returns `1=1` from shared/scopeAccess.ts. It stays true at
    // ~25 other call sites where org-wide CEO read is intended; payroll is the
    // documented exception, so it is disabled here rather than in the shared helper.
    expect(secureRoutes).not.toMatch(/allowCeoAllRead:\s*true/);
    expect(secureRoutes).toMatch(/allowCeoAllRead:\s*false/);
  });

  it("keeps the two payslip endpoints agreeing on who may read payroll", () => {
    // The original defect was a disagreement: /runs said yes to ceo, the line-items
    // endpoint said no, and the page needed both. Whatever the policy, they must match.
    const runsRoles = new Set(rolesFor(secureRoutes, "/runs"));
    const lineRoles = rolesFor(compatRoutes, "/runs/:id/lines");
    for (const role of lineRoles) {
      expect(
        runsRoles.has(role),
        `${role} can read payslip lines but not the run list — the payslip page needs both`
      ).toBe(true);
    }
  });
});

describe("payslip page dispatch", () => {
  const routeConfigRaw = readFileSync(
    resolve(process.cwd(), "../src/config/routes/payroll.routes.tsx"),
    "utf8",
  );
  // Assert against code, not prose — the explanatory comment names the old
  // predicate verbatim and would otherwise match.
  const routeConfig = routeConfigRaw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("routes on payroll entitlement rather than primaryRole === employee", () => {
    expect(
      routeConfig,
      'dispatching on primaryRole === "employee" sends every other role — CEO, ' +
        "trainer, team leader — to the org-wide admin console"
    ).not.toMatch(/primaryRole === "employee"/);
    expect(routeConfig).toContain("PAYSLIP_CENTER_ROLES");
  });

  it("does not grant the CEO the admin payslip centre", () => {
    const listMatch = routeConfig.match(/PAYSLIP_CENTER_ROLES\s*=\s*\[([\s\S]*?)\]/);
    expect(listMatch, "PAYSLIP_CENTER_ROLES not found").toBeTruthy();
    const roles = [...listMatch![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(roles).not.toContain("ceo");
    expect(roles).toEqual(expect.arrayContaining(["admin", "hr", "finance", "payroll"]));
  });
});
