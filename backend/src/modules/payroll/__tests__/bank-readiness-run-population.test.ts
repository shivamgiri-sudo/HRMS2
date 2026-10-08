import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owner ruling 2026-08-16 (decision 6): bank readiness follows the payroll RUN, not the staff
 * list, and ONE resolver produces that population for both the readiness screen and the
 * payment-file exporter.
 *
 * WHAT IT REPLACES
 * loadEmployeeBankRows ended `WHERE e.active_status = 1` unconditionally - every active
 * employee - while the payment file contains whoever has a payable line in the run. Two
 * different lists judged by one indicator.
 *
 * Measured live on run 93ff8899 (2026-07):
 *   run-scoped population ........ 1,273
 *   old org-wide population ...... 1,327
 *   payable but NOT active_status=1 . 161  (Rs 1,49,692.69) - never classified at all; they
 *                                          fell into a synthetic "NOT_ACTIVE" bucket produced
 *                                          by a ?? fallback rather than by the classifier
 *   active with no payable line ..... 215  - counted anyway, and able to hold the gate red
 *                                          over money nobody was paying them
 *
 * Source-text assertions, the convention this repo uses for large SQL-bearing services. The
 * population SQL was separately PREPARE-validated against production and its row count proved
 * against a direct query (1,273 = 1,273, no fan-out) before shipping.
 */
const SRC = readFileSync(resolve(__dirname, "../bank-payment-readiness.service.ts"), "utf8");
const ROUTES = readFileSync(resolve(__dirname, "../bank-payment-readiness.routes.ts"), "utf8");

/** Just the run-scoped branch of the loader. */
function runScopedBranch(): string {
  const start = SRC.indexOf("async function loadEmployeeBankRows");
  const end = SRC.indexOf("export interface BankReadinessReport", start);
  expect(start, "loadEmployeeBankRows not found").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("the population is scoped to a run when one is given", () => {
  it("takes an optional runId", () => {
    expect(SRC).toMatch(/async function loadEmployeeBankRows\(runId\?: string \| null\)/);
    expect(SRC).toMatch(/export async function buildBankReadinessReport\(runId\?: string \| null\)/);
  });

  it("sources the run population from payable salary_prep_line rows", () => {
    const branch = runScopedBranch();
    expect(branch).toMatch(/FROM salary_prep_line/);
    expect(branch).toMatch(/WHERE run_id = \? AND COALESCE\(net_salary, 0\) > 0/);
  });

  it("matches the run by id, never by run_month", () => {
    // Two runs can share a month - 2026-03 has twins - so joining on the month doubles rows.
    const branch = runScopedBranch();
    expect(branch).not.toMatch(/run_month/);
  });

  it("dedupes on the line side rather than grouping the joined rows", () => {
    // An employee can hold more than one payable line. GROUP BY on the result both trips
    // only_full_group_by and silently changes which bank row survives.
    const branch = runScopedBranch();
    expect(branch).toMatch(/SELECT DISTINCT employee_id/);
    expect(branch).not.toMatch(/GROUP BY e\.id/);
  });

  it("keeps the org-wide branch for the standing exceptions queue", () => {
    // Without a run this is still the right view for remediation work.
    expect(runScopedBranch()).toMatch(/WHERE e\.active_status = 1/);
  });

  it("reports which run it was scoped to", () => {
    expect(SRC).toMatch(/run_id: runId \?\? null/);
  });
});

describe("both the screen and the exporter consume that one resolver", () => {
  it("the payment file is judged on its own run", () => {
    expect(ROUTES).toMatch(/const report = await buildBankReadinessReport\(runId\)/);
  });

  it("the summary screen can be scoped to the same run", () => {
    expect(ROUTES).toMatch(/const summaryRunId = String\(req\.query\.run_id \?\? ""\)\.trim\(\) \|\| null/);
    expect(ROUTES).toMatch(/buildBankReadinessReport\(summaryRunId\)/);
  });

  it("there is exactly one definition of payability in this service", () => {
    // The whole point of the ruling: one definition, not two that drift. Counted on the
    // payability predicate itself, not on `FROM salary_prep_line` - getPaymentSourceDivergence
    // legitimately reads that table too, to compare which account each exporter would pay.
    const payablePredicate = (SRC.match(/COALESCE\(net_salary, 0\) > 0/g) ?? []).length;
    expect(payablePredicate, "a second payable-population definition has appeared").toBe(1);
  });
});
