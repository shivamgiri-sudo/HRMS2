/**
 * Payment gate requirements E (Finance sign-off) and B (population reconciliation).
 *
 * Before this, the only thing between a FINALIZED run and a bank file was validation_status.
 * Two gaps sat behind it:
 *
 *   E  salary_prep_run has carried finance_approved_by/at all along and NOTHING read them.
 *      Verified live 2026-08-17: NULL on all 66 runs — no run in this system has ever been
 *      signed off for payment, yet the export path did not require it.
 *
 *   B  Two independent payment populations existed and nothing compared them. This route derives
 *      one from salary_prep_line; bank-payment-readiness.service.ts derives another, and that is
 *      what the Bank Payment Readiness page reports. On the FINALIZED 2026-04 run they differ by
 *      270 employees and Rs 37,33,957 — entirely employees.active_status = 0, i.e. people who
 *      held April payroll lines and have since left.
 *
 * That divergence is not self-evidently an error (the exporter answers "who was owed money in
 * this run", readiness answers "who can we pay now"), which is exactly why the file must not ship
 * while the two disagree and nobody has adjudicated it.
 *
 * Asserted against the shipped source, matching the idiom of neft-export-total-integrity.test.ts:
 * the handler is a large inline Express closure with no seam to call, and what matters here is
 * ORDER — that nothing is logged or handed over after a mismatch is found.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Assert on code, not on prose that necessarily quotes the behaviour being described. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const CODE = stripComments(read("src/modules/payroll/payroll.routes.ts"));

function slice(startMarker: string, endMarker: string): string {
  const start = CODE.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = CODE.indexOf(endMarker, start);
  return CODE.slice(start, end > start ? end : start + 12000);
}

const HANDLER = slice('router.get("/runs/:id/neft-export"', 'router.patch("/runs/:id/validate"');

describe("payment gate E — Finance sign-off is required before a payment file", () => {
  it("refuses a run with no finance_approved_by", () => {
    expect(HANDLER).toContain("run.finance_approved_by");
    expect(HANDLER).toContain("FINANCE_SIGNOFF_MISSING");
  });

  it("checks sign-off BEFORE building any part of the file", () => {
    const signoff = HANDLER.indexOf("FINANCE_SIGNOFF_MISSING");
    const population = HANDLER.indexOf("FROM salary_prep_line");
    expect(signoff).toBeGreaterThan(-1);
    expect(population).toBeGreaterThan(-1);
    // A run nobody has signed off must not even be assembled into a file.
    expect(signoff).toBeLessThan(population);
  });

  it("is a distinct failure from the run-state and validation checks", () => {
    // "not signed off" is a workflow state a human resolves, not a malformed request — so it must
    // not be collapsed into the 400/403 that report a wrong run status.
    expect(HANDLER).toMatch(/FINANCE_SIGNOFF_MISSING[\s\S]{0,400}?/);
    const signoffBlock = HANDLER.slice(
      HANDLER.indexOf("finance_approved_by") - 200,
      HANDLER.indexOf("FINANCE_SIGNOFF_MISSING") + 200,
    );
    expect(signoffBlock).toContain("409");
  });
});

describe("payment gate B — the file population must reconcile against readiness", () => {
  it("CALLS the canonical readiness service rather than deriving another population", () => {
    // The whole defect being closed is "two populations". Re-deriving the comparison set here
    // would make three. buildBankReadinessReport is the one canonical answer.
    expect(HANDLER).toContain("buildBankReadinessReport(runId)");
    expect(HANDLER).toContain('readiness_class === "READY"');
  });

  it("does not run a second salary_prep_line population query for the comparison", () => {
    const reconStart = HANDLER.indexOf("buildBankReadinessReport(runId)");
    const reconEnd = HANDLER.indexOf("PAYMENT_POPULATION_MISMATCH");
    expect(reconStart).toBeGreaterThan(-1);
    expect(reconEnd).toBeGreaterThan(reconStart);
    const reconBlock = HANDLER.slice(reconStart, reconEnd);
    // The comparison must be set arithmetic over already-loaded rows, not a fresh SELECT.
    expect(reconBlock).not.toMatch(/FROM\s+salary_prep_line/i);
    expect(reconBlock).not.toMatch(/db\.execute/);
  });

  it("compares in BOTH directions — paying someone unready, and omitting someone ready", () => {
    expect(HANDLER).toContain("paidNotReady");
    expect(HANDLER).toContain("readyNotPaid");
    // A file that is short is as much a reconciliation failure as one that overpays.
    expect(HANDLER).toContain("would_pay_but_not_ready");
    expect(HANDLER).toContain("ready_but_would_not_pay");
  });

  it("refuses the file BEFORE the export log is written and before the bytes are hashed", () => {
    const mismatch = HANDLER.indexOf("PAYMENT_POPULATION_MISMATCH");
    const sha = HANDLER.indexOf("createHash(");
    const log = HANDLER.indexOf("INSERT INTO payroll_register_export_log");
    expect(mismatch).toBeGreaterThan(-1);
    expect(sha).toBeGreaterThan(-1);
    expect(log).toBeGreaterThan(-1);
    // No hash, no log row, no file — a refused export must leave no trace of having produced one.
    expect(mismatch).toBeLessThan(sha);
    expect(mismatch).toBeLessThan(log);
  });

  it("reconciles the set that is actually PAID, not the set that was queried", () => {
    // paidEmployeeIds is appended only on the branch that writes a CSV payment row, after the
    // unpayable `continue`. Reconciling the queried rows instead would compare the wrong set and
    // pass while excluded employees silently differed from readiness.
    expect(HANDLER).toContain("paidEmployeeIds.push(String(line.employee_id))");
    const push = HANDLER.indexOf("paidEmployeeIds.push");
    const unpayablePush = HANDLER.indexOf("unpayable.push");
    expect(unpayablePush).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(unpayablePush);
  });

  /**
   * Readiness verifies against db_bill, which is LAN-only. Unreachable, the report degrades and
   * every row leaves READY — measured 2026-08-17 from off-LAN: 0 READY out of 837 payable. The
   * file must still be refused, but calling that a population MISMATCH would send whoever reads
   * it hunting for 837 bad bank records that do not exist.
   */
  it("distinguishes 'cannot verify' from 'populations disagree'", () => {
    expect(HANDLER).toContain("verification_source.available");
    expect(HANDLER).toContain("PAYMENT_READINESS_UNVERIFIABLE");
    // Checked before the set comparison, or a degraded report is misreported as a mismatch.
    const unverifiable = HANDLER.indexOf("PAYMENT_READINESS_UNVERIFIABLE");
    const mismatch = HANDLER.indexOf("PAYMENT_POPULATION_MISMATCH");
    expect(unverifiable).toBeGreaterThan(-1);
    expect(unverifiable).toBeLessThan(mismatch);
    // And it must still refuse — an unverifiable population may not become a bank file.
    const block = HANDLER.slice(unverifiable - 300, unverifiable + 300);
    expect(block).toContain("409");
  });

  it("reports the amount at stake, not just a count", () => {
    // "270 employees differ" is not actionable; "270 employees, Rs 37,33,957" is.
    expect(HANDLER).toContain("exporter_payable_total");
    expect(HANDLER).toMatch(/amount:\s*Number\(sumOf\(paidNotReady\)/);
  });
});
