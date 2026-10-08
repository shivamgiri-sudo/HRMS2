import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bulk payslip generation must actually generate payslips.
 *
 * WHAT WENT WRONG
 *   POST /runs/:id/bulk-generate-payslips reported success, flipped
 *   salary_prep_line.payslip_generated on every line, and wrote nothing to
 *   salary_payslip. Its entire worker body was one UPDATE. payslipService
 *   .generatePayslip — the only writer of salary_payslip in the repo — was
 *   called from exactly one place, the single-employee route, and never here.
 *
 *   Verified live 2026-08-17: salary_payslip held 2,855 rows, every one of them
 *   carrying the SAME generated_at (a one-shot backfill on 2026-06-11), and not
 *   a single row for any month after 2026-03. Meanwhile bulk-payslip-summary
 *   reads payslip_generated, so it would have reported 100% generated for runs
 *   with zero payslips. A success path asserting work it did not do.
 *
 * WHY A SOURCE CONTRACT RATHER THAN A BEHAVIOURAL TEST
 *   The work happens in a fire-and-forget setImmediate after the response is
 *   sent, so there is nothing to await and no return value to assert. What is
 *   worth pinning is structural and survives refactoring: this handler must
 *   route through the shared generator rather than growing its own INSERT, or
 *   salary_payslip acquires a second writer and the two drift.
 */
describe("bulk payslip generation", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/payroll-more.routes.ts"),
    "utf8",
  );

  /** The worker body of the bulk-generate route, isolated from the rest of the file. */
  function bulkGenerateWorker(): string {
    const start = source.indexOf('"/runs/:id/bulk-generate-payslips"');
    expect(start, "bulk-generate-payslips route not found").toBeGreaterThan(-1);
    const next = source.indexOf("payrollMoreRouter.", start + 1);
    return next > 0 ? source.slice(start, next) : source.slice(start);
  }

  it("calls the shared payslip generator, so salary_payslip rows are actually written", () => {
    const body = bulkGenerateWorker();
    expect(
      body,
      "bulk generation must call payslipService.generatePayslip — without it the job flips " +
        "payslip_generated and produces no payslip",
    ).toMatch(/payslipService\.generatePayslip\(/);
  });

  it("still marks the line, so bulk-payslip-summary keeps working", () => {
    const body = bulkGenerateWorker();
    expect(body).toMatch(/payslip_generated\s*=\s*1/);
  });

  it("does not grow a second writer for salary_payslip", () => {
    // One writer only. If this handler ever INSERTs directly, the upsert semantics and the
    // audit log in payslipService diverge from whatever is written here.
    const body = bulkGenerateWorker();
    expect(body).not.toMatch(/INSERT\s+INTO\s+salary_payslip/i);
  });

  it("records why a payslip failed rather than only counting failures", () => {
    // A bare `catch { job.failed++ }` told an operator "40 failed" and nothing else, on a job
    // whose output is invisible until someone opens a payslip.
    const body = bulkGenerateWorker();
    expect(body).toMatch(/job\.error\s*=/);
  });

  it("imports the generator from the payslip service module", () => {
    expect(source).toMatch(/import\s*\{\s*payslipService\s*\}\s*from\s*["']\.\/payslip\.service\.js["']/);
  });
});
