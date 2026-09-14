/**
 * POST /runs/:id/calculate and POST /runs/:id/correct-weekoffs both recalculate a payroll run,
 * which clears finance/CEO/Head-Payroll sign-off stamps and applied-incentives markers when it
 * changes figures (payrollCalculate.service.ts unconditionally nulls them — see that file's own
 * tests for that half). That clearing is correct; doing it with no confirmation was not.
 *
 * /calculate got a 409-unless-force=true gate on 2026-08-14 (commit 9fb5215e) but shipped with no
 * dedicated test of its own — verified only by the full payroll suite not breaking. /correct-
 * weekoffs triggers the identical recalculation path but had no gate at all until this change.
 * Both are covered here, asserted against the shipped source (large inline Express closures with
 * no seam to call directly — same convention as neft-export-total-integrity.test.ts).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ROUTES = read("src/modules/payroll/payroll.routes.ts");
const CODE = stripComments(ROUTES);

function slice(startMarker: string, endMarker: string): string {
  const start = CODE.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = CODE.indexOf(endMarker, start);
  return CODE.slice(start, end > start ? end : start + 4000);
}

const CALCULATE_HANDLER = slice(
  'router.post("/runs/:id/calculate"',
  'router.post("/runs/:id/correct-weekoffs"',
);
const CORRECT_WEEKOFFS_HANDLER = slice(
  'router.post("/runs/:id/correct-weekoffs"',
  'router.post("/runs/:id/',
);

describe.each([
  ["POST /runs/:id/calculate", () => CALCULATE_HANDLER],
  ["POST /runs/:id/correct-weekoffs", () => CORRECT_WEEKOFFS_HANDLER],
])("%s refuses to silently invalidate an approved run's sign-off", (_name, getHandler) => {
  it("checks status=approved, finance/CEO sign-off, and validation before recalculating", () => {
    const handler = getHandler();
    expect(handler).toContain('"status=approved"');
    expect(handler).toContain("finance_approved_at");
    expect(handler).toContain("ceo_acknowledged_at");
    expect(handler).toContain("validation_status");
  });

  it("returns 409 with the specific markers found, not a generic error", () => {
    const handler = getHandler();
    expect(handler).toContain("res.status(409)");
    expect(handler).toContain("approvalMarkers");
  });

  it("is bypassable only by an explicit force=true, not a bare retry", () => {
    const handler = getHandler();
    expect(handler).toMatch(/req\.body\?\.force === true \|\| req\.query\?\.force === "true"/);
    expect(handler).toContain("if (!forceRecalc)");
  });

  it("the guard runs before the recalculation call, not after", () => {
    const handler = getHandler();
    const iGuard = handler.indexOf("if (!forceRecalc)");
    const iCalc = Math.max(
      handler.indexOf("calculatePayrollRun("),
      handler.indexOf("calculatePayrollRunScoped("),
    );
    expect(iGuard).toBeGreaterThan(-1);
    expect(iCalc).toBeGreaterThan(iGuard);
  });
});

describe("correct-weekoffs additionally checks incentives_applied_at, matching /calculate's separate B6 gate", () => {
  it("folds the incentives-applied check into the same 409, since both routes hit the same clearing logic", () => {
    expect(CORRECT_WEEKOFFS_HANDLER).toContain("incentives_applied_at");
    expect(CORRECT_WEEKOFFS_HANDLER).toContain('"incentives-applied"');
  });
});
