/**
 * Regression tests for a bug that recurred every time it was "fixed".
 *
 * run-status.ts and payrollRunLockStatuses.test.ts already document/pin the
 * root cause: closed-run guards were hand-written `["locked","disbursed"]`,
 * which matches zero production rows because runs actually finish `FINALIZED`.
 * That pattern turned out to recur in six more places once searched for
 * exhaustively:
 *
 *  - payroll-window.routes.ts:  window-status, PATCH tds-mode, POST manual-tds
 *  - payroll-extended.routes.ts: GET runs/:id/neft-export
 *  - payroll.routes.ts:         GET runs/:id/neft-export (a second, duplicated
 *                                implementation), the TDS-certificate FY summary
 *                                query, and the self-service payslip-history
 *                                ranking
 *  - payroll-window.cron.ts:    the auto-lock sweep's exclusion list
 *  - payroll.service.ts:        getPayrollOverview's canonical-run ranking and
 *                                its no-run-for-month fallback
 *
 * Each assertion below reads the real source file as text (the same technique
 * payrollRunLockStatuses.test.ts uses) so this fails the moment any of these
 * six sites regresses back to a literal that forgets 'finalized'.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const WINDOW_ROUTES = read("src/modules/payroll/payroll-window.routes.ts");
const WINDOW_CRON = read("src/modules/payroll/payroll-window.cron.ts");
const PAYROLL_ROUTES = read("src/modules/payroll/payroll.routes.ts");
const PAYROLL_EXTENDED_ROUTES = read("src/modules/payroll/payroll-extended.routes.ts");
const PAYROLL_SERVICE = read("src/modules/payroll/payroll.service.ts");

describe("payroll-window.routes.ts no longer hand-rolls the closed-run check", () => {
  it("imports isRunClosed instead of redefining the set", () => {
    expect(WINDOW_ROUTES).toMatch(/import\s*{\s*isRunClosed\s*}\s*from\s*['"]\.\/run-status\.js['"]/);
  });

  it("window-status, tds-mode and manual-tds all route through isRunClosed, not a literal array", () => {
    const occurrences = WINDOW_ROUTES.match(/isRunClosed\(run\.status\)/g) ?? [];
    expect(occurrences.length, "expected 3 call sites: window-status, PATCH tds-mode, POST manual-tds").toBe(3);
  });

  it("does not still contain the dead literal", () => {
    expect(WINDOW_ROUTES).not.toMatch(/\[\s*['"]locked['"]\s*,\s*['"]disbursed['"]\s*\]\.includes/);
  });
});

describe("payroll-window.cron.ts auto-lock sweep excludes settled runs", () => {
  it("the exclusion list is built from the shared CLOSED_RUN_STATUSES_SQL (proven to include 'finalized' by run-status.test.ts), not a hand-written literal", () => {
    expect(WINDOW_CRON).toMatch(/import\s*{\s*CLOSED_RUN_STATUSES_SQL\s*}\s*from\s*['"]\.\/run-status\.js['"]/);
    const m = WINDOW_CRON.match(/status NOT IN \(([^)]*)\)/);
    expect(m, "exclusion clause has moved or changed shape").toBeTruthy();
    expect(m![1]).toContain("${CLOSED_RUN_STATUSES_SQL}");
    expect(m![1].toLowerCase()).toContain("cancelled");
  });
});

describe("NEFT export is reachable for finalized runs (two implementations)", () => {
  it("payroll.routes.ts NEFT export uses isRunClosed", () => {
    const section = PAYROLL_ROUTES.slice(PAYROLL_ROUTES.indexOf('"/runs/:id/neft-export"'));
    expect(section.slice(0, 900)).toMatch(/isRunClosed\(run\.status\)/);
  });

  it("payroll-extended.routes.ts NEFT export uses isRunClosed", () => {
    expect(PAYROLL_EXTENDED_ROUTES).toMatch(/import\s*{\s*isRunClosed\s*}\s*from\s*['"]\.\/run-status\.js['"]/);
    expect(PAYROLL_EXTENDED_ROUTES).toMatch(/isRunClosed\(run\.status\)/);
  });
});

describe("TDS certificate FY summary counts finalized months", () => {
  it("the status allow-list includes finalized", () => {
    const m = PAYROLL_ROUTES.match(/AND spr\.status IN \(([^)]*)\)\s*\n\s*AND spl\.status NOT IN \('excluded', 'blocked'\)/);
    expect(m, "TDS certificate FY query has moved or changed shape").toBeTruthy();
    expect(m![1].toLowerCase()).toContain("'finalized'");
  });

  it("the per-month canonical-run ranking includes finalized", () => {
    expect(PAYROLL_ROUTES).toMatch(/FIELD\(spr\.status, 'disbursed', 'finalized'/);
  });
});

describe("self-service payslip-history ranking accounts for finalized runs", () => {
  it("the FIELD() ranking used for /payslip/history/:employeeId includes finalized", () => {
    expect(PAYROLL_ROUTES).toMatch(/FIELD\(spr\.status,'disbursed','finalized'/);
  });
});

describe("payroll.service.ts getPayrollOverview picks the real settled run", () => {
  it("the canonical-run CASE ranking includes finalized ahead of draft/processing", () => {
    const m = PAYROLL_SERVICE.match(/CASE status([\s\S]*?)END,/);
    expect(m, "getPayrollOverview ranking has moved or changed shape").toBeTruthy();
    expect(m![1]).toMatch(/WHEN 'finalized'\s*THEN/);
  });

  it("the no-run-for-month fallback query includes finalized", () => {
    const m = PAYROLL_SERVICE.match(/WHERE status IN \(([^)]*)\)\s*\n\s*ORDER BY run_month DESC/);
    expect(m, "getPayrollOverview fallback query has moved or changed shape").toBeTruthy();
    expect(m![1].toLowerCase()).toContain("'finalized'");
  });
});
