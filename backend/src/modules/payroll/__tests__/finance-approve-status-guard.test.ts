import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * POST /runs/:runId/finance-approve SELECTed salary_prep_run.status and then never looked at
 * it. The only guard was finance_approved_at, so finance sign-off could be stamped on a run in
 * any state — including a 'draft' whose calculation FAILED (payrollCalculate.service.ts resets
 * to 'draft' on failure) and a 'FINALIZED' run from closed history spanning 2021-2026.
 *
 * GET /runs in the same file already refuses to list either as pending sign-off. The mutation
 * simply did not agree with the query that decides what is approvable — the same shape as the
 * exit-FSM gap fixed earlier in this programme.
 *
 * Verified live 2026-08-15: 0 of 66 runs have ever been finance-approved (FINALIZED 51,
 * approved 12, processing 2, draft 1), so the guard blocks nothing that has happened.
 *
 * Asserted against the shipped source: this handler is a large inline Express closure with no
 * seam to call, and the property that matters is which states it refuses — matching the
 * established contract-test style used by payroll-signoff-schema-contract.test.ts beside it.
 */

const SRC = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll-signoff.routes.ts"),
  "utf8",
);

/** The finance-approve handler body, from its route registration to the audit write. */
function handler(): string {
  const start = SRC.indexOf('"/runs/:runId/finance-approve"');
  expect(start, "finance-approve route not found").toBeGreaterThan(-1);
  const end = SRC.indexOf("PAYROLL_FINANCE_APPROVE", start);
  return SRC.slice(start, end > start ? end : start + 4000);
}

describe("finance-approve refuses runs that cannot legitimately be signed off", () => {
  it("reads the status it already selected, instead of ignoring it", () => {
    const body = handler();
    expect(body).toMatch(/run\.status/);
    expect(body).toMatch(/runStatus/);
  });

  it("refuses a draft run — its calculation has not completed", () => {
    const body = handler();
    expect(body).toMatch(/runStatus === "draft"/);
    expect(body).toMatch(/calculation has not completed/i);
  });

  it("refuses a finalized run — closed history is not a sign-off queue", () => {
    const body = handler();
    expect(body).toMatch(/runStatus === "finalized"/);
    expect(body).toMatch(/closed history/i);
  });

  it("compares case-insensitively, because this column mixes casing", () => {
    // 'FINALIZED' is uppercase while every other value is lowercase; a case-sensitive
    // comparison has already caused production defects elsewhere in this module.
    const body = handler();
    expect(body).toMatch(/\.toLowerCase\(\)/);
  });

  it("refuses with 409, not 400 — the request is valid, the run's state is not", () => {
    const body = handler();
    const guard = body.slice(body.indexOf("runStatus === \"draft\""));
    expect(guard).toMatch(/status\(409\)/);
  });

  it("does NOT allow-list a single status, so the 12 live 'approved' runs are not stranded", () => {
    // Deny-list is deliberate: 'processing' is what the queue lists, but nothing proves
    // 'approved' is not a legitimate pre-finance state, and allow-listing would silently
    // block those 12 runs from ever being signed off.
    const body = handler();
    expect(body).not.toMatch(/runStatus !== "processing"/);
  });

  it("still refuses a run that is already finance-approved", () => {
    // The pre-existing guard must survive — this change adds to it, it does not replace it.
    expect(handler()).toMatch(/already finance-approved/);
  });
});
