/**
 * Management Dashboard redaction contract.
 *
 * GET /api/management/ceo-metrics admits `admin, hr, ceo, finance`, but nulls
 * the fields in PAYROLL_ONLY_FIELDS for any caller that is not in PAYROLL_ROLES.
 * `ceo` and `hr` are on the route's role list and NOT in PAYROLL_ROLES, so for
 * those two roles the redacted fields are ALWAYS null.
 *
 * CEO UAT 31-Jul-2026 (finding: Management Dashboard, Critical) reported:
 *   "Cannot read properties of null (reading 'total_gross')"
 * caused by `ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.total_gross) : "—"`
 * — a guard that tests only the container, never the redacted field.
 *
 * These tests read source text rather than rendering, matching the idiom of the
 * other contract tests here (no DOM environment is configured — see
 * vitest.config.ts). Source-level assertion is also what we want: the defect
 * appeared at eight separate call sites, and a render test of one tile would
 * not stop a ninth being added.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const DASHBOARD = path.join(ROOT, "src/pages/NativeManagementDashboard.tsx");
const ROUTES = path.join(ROOT, "backend/src/modules/management/management.routes.ts");

const dashboardSrc = readFileSync(DASHBOARD, "utf8");
const routesSrc = readFileSync(ROUTES, "utf8");

/** The single source of truth for what the backend redacts. */
function payrollOnlyFields(): string[] {
  const block = routesSrc.match(/PAYROLL_ONLY_FIELDS\s*=\s*\[([^\]]+)\]/);
  if (!block) throw new Error("PAYROLL_ONLY_FIELDS not found in management.routes.ts");
  return [...block[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("management dashboard — redacted payroll fields", () => {
  it("backend still declares the redacted fields this test guards", () => {
    expect(payrollOnlyFields()).toEqual(["payroll_liability", "ff_liability"]);
  });

  it("the redaction is reachable by roles the route admits", () => {
    // If `ceo` were ever added to PAYROLL_ROLES this whole class of bug would be
    // unreachable — but it is not, so the null path is live in production.
    const allowed = routesSrc.match(/\/ceo-metrics",\s*requireRole\(([^)]*)\)/);
    expect(allowed?.[1]).toContain('"ceo"');
  });

  for (const field of payrollOnlyFields()) {
    it(`never dereferences a property of \`${field}\` without a null guard`, () => {
      // Matches `ceoMetrics.<field>.x` and `ceoMetrics?.<field>.x` — in both the
      // hop off <field> is unguarded, which is exactly what threw in UAT.
      // `ceoMetrics?.<field>?.x` is the safe form and is not matched.
      const unguarded = new RegExp(`ceoMetrics\\s*\\??\\.\\s*${field}\\s*\\.`, "g");

      const offenders = dashboardSrc
        .split("\n")
        .map((line, i) => ({ line: i + 1, text: line.trim() }))
        .filter(({ text }) => unguarded.test(text))
        // A hop guarded earlier in the same expression is safe, e.g.
        // `ceoMetrics.payroll_liability ? ceoMetrics.payroll_liability.total_net : null`
        .filter(({ text }) => !new RegExp(`ceoMetrics\\s*\\??\\.\\s*${field}\\s*(&&|\\?[^.])`).test(text));

      expect(
        offenders,
        `${field} is nulled by the backend for ceo/hr. Use optional chaining ` +
          `(ceoMetrics?.${field}?.x) or guard the field before dereferencing.\n` +
          offenders.map((o) => `  line ${o.line}: ${o.text}`).join("\n")
      ).toEqual([]);
    });
  }

  it("distinguishes a deliberate redaction from missing data", () => {
    // An em-dash for a redaction reads as a broken dashboard; the backend
    // already tells us which fields it withheld via the `restricted` array.
    expect(routesSrc).toMatch(/restricted:\s*\[\.\.\.PAYROLL_ONLY_FIELDS\]/);
    expect(dashboardSrc).toMatch(/restricted\s*\?\?\s*\[\]/);
    expect(dashboardSrc).toContain("Restricted");
  });
});
