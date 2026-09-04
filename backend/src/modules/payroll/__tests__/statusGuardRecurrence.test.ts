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
  it("the auto-lock exclusion list is built from the shared LOCK_TERMINAL_STATUSES_SQL, not a literal and not the recompute set", () => {
    // This originally pinned CLOSED_RUN_STATUSES_SQL. Its intent — use a shared constant,
    // never a literal — was right, but the constant was wrong, and pinning it here is what
    // held the bug in place. CLOSED_RUN_STATUSES answers "may this run be RECOMPUTED" and
    // correctly contains 'finalized'. The auto-lock sweep asks a different question: "may
    // this run still MOVE FORWARD". Every production run finishes as 'finalized', so
    // excluding it meant finalized -> locked never fired; 2026-07 passed its
    // window_close_date of 2026-08-29 with auto_closed_at still NULL, and
    // payroll-lifecycle.ts lists 'locked' as finalized's only forward target.
    expect(WINDOW_CRON).toMatch(/LOCK_TERMINAL_STATUSES_SQL/);
    // The auto-lock query is the FIRST `status NOT IN (...)` in the file; the second belongs
    // to the closing-warning sweep, which correctly still uses the recompute set (a
    // finalized run cannot be corrected, so it must not be warned about).
    const m = WINDOW_CRON.match(/status NOT IN \(([^)]*)\)/);
    expect(m, "exclusion clause has moved or changed shape").toBeTruthy();
    expect(m![1]).toContain("${LOCK_TERMINAL_STATUSES_SQL}");
    expect(m![1]).not.toContain("${CLOSED_RUN_STATUSES_SQL}");
  });
});

/**
 * Source of a single route handler: from its path literal to the next route
 * registration. Bounded this way rather than by a fixed character count, which
 * silently breaks the moment a comment is added inside the handler.
 */
function handlerSource(source: string, path: string): string {
  const start = source.indexOf(`"${path}"`);
  expect(start, `route ${path} not found`).toBeGreaterThan(-1);
  const next = source.indexOf("\nrouter.", start);
  const slice = source.slice(start, next === -1 ? source.length : next);
  /*
   * A route may delegate to a named handler so ONE implementation serves several URLs — the payment
   * file is registered at both /runs/:id/neft-export and /month/:month/neft-export, because a month
   * paid in several runs must still produce a single bank file. Follow the reference, so this keeps
   * inspecting the code that runs rather than the registration line.
   */
  const delegated = slice.match(/,\s*(\w+Handler)\s*\)\s*;/);
  if (delegated) {
    const defIdx = source.indexOf(`const ${delegated[1]} =`);
    if (defIdx > -1) {
      const end = source.indexOf("\nrouter.", defIdx);
      return source.slice(defIdx, end === -1 ? source.length : end);
    }
  }
  return slice;
}

describe("NEFT export is reachable for finalized runs (two implementations)", () => {
  it("payroll.routes.ts NEFT export uses isRunClosed", () => {
    // isRunClosed is still the check; it is now applied to every run in scope, because one handler
    // serves both /runs/:id/neft-export and /month/:month/neft-export and a month paid in several
    // runs must still produce a single bank file.
    expect(handlerSource(PAYROLL_ROUTES, "/runs/:id/neft-export")).toMatch(/isRunClosed\(r\.status\)/);
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
