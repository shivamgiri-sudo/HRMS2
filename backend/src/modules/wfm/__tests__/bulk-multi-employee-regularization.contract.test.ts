import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Multi-employee bulk attendance correction.
 *
 * WHY IT EXISTS
 *   /regularizations/batch covers one employee across up to 31 dates — right for an individual
 *   who forgot to punch, wrong for a systemic failure. When a branch's biometric feed breaks the
 *   correction is a rectangle: many employees x many dates. Measured live 2026-08-17, Delhi
 *   Office ran 612 August attendance rows of which 100% were missing_punch across 51 employees;
 *   org-wide 30% of August rows are missing_punch with 4,255 unresolved blocker-severity
 *   reconciliation issues.
 *
 * WHAT THESE TESTS PROTECT
 *   The endpoint is an ORIGINATION tool, never an approval bypass. A bulk correction that wrote
 *   straight to attendance_daily_record would let one person move payable days for a whole
 *   branch with nobody reviewing it — and payable days are money. Every pair must go through
 *   wfmService.submitRegularization so it lands PENDING and inherits the existing risk scoring,
 *   duplicate detection and manager -> WFM -> (frozen months) Payroll chain.
 *
 *   Scope is the other half. canAccessEmployee must be called PER EMPLOYEE, not once for the
 *   request, or a branch-scoped WFM user widens their own reach just by naming other branches'
 *   employees in the payload.
 */
describe("multi-employee bulk regularization", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/modules/wfm/wfm.regularization.secure.routes.ts"),
    "utf8",
  );

  /** The handler body, isolated from its neighbours. */
  function handler(): string {
    const start = source.indexOf('"/regularizations/bulk-multi-employee"');
    expect(start, "bulk-multi-employee route not found").toBeGreaterThan(-1);
    const next = source.indexOf("wfmRegularizationSecureRouter.", start + 1);
    return next > 0 ? source.slice(start, next) : source.slice(start);
  }

  it("raises requests through the shared submit path rather than writing attendance", () => {
    const body = handler();
    expect(body).toMatch(/wfmService\.submitRegularization\(/);
  });

  it("never writes attendance_daily_record directly", () => {
    // The whole point. Writing attendance here would skip approval entirely.
    const body = handler();
    expect(body).not.toMatch(/UPDATE\s+attendance_daily_record/i);
    expect(body).not.toMatch(/INSERT\s+INTO\s+attendance_daily_record/i);
  });

  it("checks scope for every employee in the payload, inside the loop", () => {
    const body = handler();
    expect(body).toMatch(/canAccessEmployee\(/);
    // The call must sit inside the per-target loop, not before it — otherwise one authorised
    // employee in the list authorises the whole batch.
    const loopStart = body.indexOf("for (const target of targets)");
    const scopeCall = body.indexOf("canAccessEmployee(");
    expect(loopStart, "per-target loop not found").toBeGreaterThan(-1);
    expect(scopeCall).toBeGreaterThan(loopStart);
  });

  it("requires a privileged role to correct on behalf of other employees", () => {
    const body = handler();
    expect(body).toMatch(/hasAnyRole\(/);
    expect(body).toMatch(/403/);
  });

  it("requires a substantive reason, since it is the audit record for the whole batch", () => {
    const body = handler();
    expect(body).toMatch(/reason\.length\s*<\s*10/);
  });

  it("bounds the batch so one call cannot hold an unbounded write loop open", () => {
    const body = handler();
    expect(body).toMatch(/MAX_PAIRS/);
  });

  it("audits every raised request individually", () => {
    const body = handler();
    expect(body).toMatch(/logSensitiveAction\(/);
    expect(body).toMatch(/REGULARIZATION_SUBMITTED/);
  });

  it("reports per-pair outcomes instead of failing the whole batch on one bad row", () => {
    const body = handler();
    expect(body).toMatch(/results\.push\(/);
    expect(body).toMatch(/denied/);
  });
});
