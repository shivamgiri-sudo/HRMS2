/**
 * Salary certificate + BGV manual review: call sites must address the routes the
 * backend actually mounts, and the certificate table must be joinable.
 *
 * Three defects, all confirmed against production on 2026-07-31 by probing with a
 * valid super_admin token (a token is required — an unauthenticated probe 401s on
 * missing and present routes alike, because clientRouter applies requireAuth on
 * the bare /api prefix; with a token, a missing route says "Route not found: ..."
 * while a live one returns a business error):
 *
 * 1. payrollCertificatesRouter is mounted at /api/payroll/salary-certificates,
 *    but SalaryCertificate.tsx called /api/payroll/certificates/... Live:
 *      {"message":"Route not found: POST /api/payroll/certificates/generate"}
 *    Both the generate mutation and the history query were dead. The request
 *    payloads already matched the handlers exactly — only the prefix was wrong.
 *
 * 2. NativeHROnboardingRequests.tsx posted to
 *    /api/ats/bgv/manual-review/:candidateId; the route is
 *    /api/ats/bgv/candidates/:candidateId/manual-review. Live: "Route not found".
 *    The body ({checkId, status, remarks}) already matched manualReview()'s
 *    signature, and BgvManualAction is the same four-value union the service
 *    declares, so again only the path was wrong.
 *
 * 3. GET /api/payroll/salary-certificates/employee/:id returned 500 for every
 *    caller — not a missing-row error. salary_certificate_request was created
 *    without the explicit COLLATE this schema uses everywhere else, so it landed
 *    on utf8mb4_0900_ai_ci while employees is utf8mb4_unicode_ci:
 *      ERROR 1267: Illegal mix of collations ... for operation '='
 *    The clash is in the join predicate, so no id could ever succeed.
 *    Migration 1028 converts the table (0 rows, so nothing to re-encode).
 *
 * Source/manifest assertions: the suite has no live DB, and each failure was a
 * mismatch between a string in the client and what the server mounts or the
 * schema provides — which is what source assertions catch and a mock would not.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const readRepo = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");
const readBackend = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const app = readBackend("src/app.ts");
const certRoutes = readBackend("src/modules/payroll/payroll-certificates.routes.ts");
const bgvRoutes = readBackend("src/modules/ats/bgv-verification.routes.ts");
const runner = readBackend("src/db/runPendingMigrations.ts");
const migration = readBackend("sql/1028_salary_certificate_request_collation.sql");
const certPage = readRepo("src/pages/payroll/SalaryCertificate.tsx");
const onboardingPage = readRepo("src/pages/NativeHROnboardingRequests.tsx");

/** The prefix app.ts actually mounts payrollCertificatesRouter on. */
function certMountPrefix(): string {
  const m = /app\.use\(\s*"(\/api\/payroll\/[a-z-]+)"[^)]*payrollCertificatesRouter/.exec(app);
  if (!m) throw new Error("payrollCertificatesRouter mount not found in app.ts");
  return m[1];
}

describe("salary certificate — client calls the mounted prefix", () => {
  it("app.ts mounts the router on exactly one payroll prefix", () => {
    expect(certMountPrefix()).toBe("/api/payroll/salary-certificates");
  });

  it("every certificate call in the page targets that prefix", () => {
    const calls = [...certPage.matchAll(/["'`](\/api\/payroll\/[^"'`$]*)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.startsWith(certMountPrefix())).toBe(true);
  });

  it("does not use the dead /api/payroll/certificates prefix", () => {
    expect(certPage).not.toContain("/api/payroll/certificates");
  });

  it("the paths it calls exist on the router", () => {
    expect(certPage).toContain("/api/payroll/salary-certificates/generate");
    expect(certRoutes).toMatch(/payrollCertificatesRouter\.post\(\s*\n?\s*"\/generate"/);
    expect(certPage).toContain("/api/payroll/salary-certificates/employee/");
    expect(certRoutes).toMatch(/payrollCertificatesRouter\.get\(\s*\n?\s*"\/employee\/:employeeId"/);
  });
});

describe("bgv manual review — client calls the mounted path", () => {
  it("posts to /candidates/:id/manual-review, the shape the router declares", () => {
    expect(onboardingPage).toContain("/api/ats/bgv/candidates/");
    expect(onboardingPage).toContain("/manual-review`");
    expect(bgvRoutes).toContain('router.post("/candidates/:candidateId/manual-review"');
  });

  it("no longer uses the flat path that 404'd", () => {
    expect(onboardingPage).not.toContain("/api/ats/bgv/manual-review/");
  });

  it("still sends the body the handler requires", () => {
    // The route 400s without remarks; manualReview() reads checkId/status/remarks.
    expect(onboardingPage).toMatch(/checkId: state\.checkId/);
    expect(onboardingPage).toMatch(/status: state\.status/);
    expect(onboardingPage).toMatch(/remarks: state\.remarks/);
  });
});

describe("salary_certificate_request — collation", () => {
  it("migration 1028 converts it to the collation employees uses", () => {
    expect(migration).toContain("salary_certificate_request");
    expect(migration).toContain("CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    // Guarded, so a re-run is a no-op rather than a full table rewrite.
    expect(migration).toContain("TABLE_COLLATION <> 'utf8mb4_unicode_ci'");
  });

  it("is registered in the manifest, or it never runs", () => {
    expect(runner).toContain("1028_salary_certificate_request_collation.sql");
  });

  it("leaves the large mis-collated tables alone", () => {
    // Converting these rewrites millions of rows under a metadata lock.
    for (const table of ["cosec_punch_sync", "cosec_daily_agg", "migration_log"]) {
      expect(migration).not.toMatch(new RegExp(`ALTER TABLE ${table}`));
    }
  });
});
