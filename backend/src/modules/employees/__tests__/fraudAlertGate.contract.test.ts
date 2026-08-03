/**
 * An unresolved fraud alert must stop a candidate becoming an employee.
 *
 * Every fraud signal this system raises is currently advisory. Six alerts exist
 * in production, all `status='open'` with `reviewed_by` NULL, and nothing reads
 * them. `criticalMismatch -> overall_status='hold'` is computed in
 * bgv-verification.service and consumed by nobody, and `checkBgvReadiness` sits
 * inside a try/catch in the orchestrator, so even a thrown BGV failure cannot
 * stop creation. Detection without a consequence is not a control.
 *
 * The gate is placed at employee creation rather than at onboarding submission
 * deliberately: a candidate who trips a false positive still completes all ten
 * steps, and Payroll HR resolves it before the offer converts. Blocking the form
 * would strand real people — married-name changes and OCR misreads are common —
 * with no self-service route out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state: { alerts: Array<Record<string, unknown>> } = { alerts: [] };

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async () => [[]]), query: vi.fn(async () => [[]]) },
}));

const { validateNoOpenFraudAlerts } = await import("../employee-creation-orchestrator.service.js");

/** Stands in for the pool connection the orchestrator passes through. */
const conn = {
  execute: vi.fn(async (sql: string) => {
    if (String(sql).includes("candidate_fraud_alert")) return [state.alerts];
    return [[]];
  }),
} as never;

beforeEach(() => { state.alerts = []; });

describe("fraud alert gate", () => {
  it("allows creation when nothing is outstanding", async () => {
    const result = await validateNoOpenFraudAlerts(conn, "cand-1");
    expect(result.valid).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("blocks creation while a high-severity alert is open", async () => {
    state.alerts = [{ alert_type: "DUPLICATE_BANK_ACCOUNT", severity: "critical", id: "a1" }];
    const result = await validateNoOpenFraudAlerts(conn, "cand-2");
    expect(result.valid).toBe(false);
    expect(result.blockers[0].severity).toBe("critical");
  });

  it("names the alert so the blocker is actionable rather than mysterious", async () => {
    state.alerts = [{ alert_type: "BANK_HOLDER_NAME_DIVERGENCE", severity: "high", id: "a2" }];
    const result = await validateNoOpenFraudAlerts(conn, "cand-3");
    expect(result.blockers[0].reason).toContain("BANK_HOLDER_NAME_DIVERGENCE");
  });

  it("does not block on a medium-severity alert", async () => {
    // FRAUD_CHECK_FAILED is medium: it means a check could not run, which is
    // worth a look but is not evidence against the candidate.
    state.alerts = [{ alert_type: "FRAUD_CHECK_FAILED", severity: "medium", id: "a3" }];
    const result = await validateNoOpenFraudAlerts(conn, "cand-4");
    expect(result.valid).toBe(true);
  });

  it("reports every open alert, not just the first", async () => {
    state.alerts = [
      { alert_type: "DUPLICATE_AADHAAR", severity: "critical", id: "a4" },
      { alert_type: "DUPLICATE_PAN", severity: "critical", id: "a5" },
    ];
    const result = await validateNoOpenFraudAlerts(conn, "cand-5");
    expect(result.blockers[0].reason).toContain("DUPLICATE_AADHAAR");
    expect(result.blockers[0].reason).toContain("DUPLICATE_PAN");
  });

  it("lets creation proceed once a reviewer has cleared the alert", async () => {
    // Cleared alerts are excluded by the query's status filter, so an empty
    // result is exactly what a reviewed alert looks like here.
    state.alerts = [];
    expect((await validateNoOpenFraudAlerts(conn, "cand-6")).valid).toBe(true);
  });
});

describe("the gate is wired into creation, and cannot be swallowed", () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), "src/modules/employees/employee-creation-orchestrator.service.ts"),
    "utf8",
  );

  it("createEmployeeFromCandidate calls the gate", () => {
    expect(SOURCE).toMatch(/await validateNoOpenFraudAlerts\(/);
  });

  it("a tripped gate rolls the transaction back rather than warning", () => {
    const at = SOURCE.indexOf("await validateNoOpenFraudAlerts(");
    const block = SOURCE.slice(at, at + 500);
    expect(block).toContain("rollback");
    expect(block).toContain("result.blockers.push");
  });

  it("the gate is not inside a try/catch that would discard its failure", () => {
    // checkBgvReadiness was neutered exactly this way: wrapped in a catch, so a
    // thrown readiness failure became a silent pass.
    const at = SOURCE.indexOf("await validateNoOpenFraudAlerts(");
    const preceding = SOURCE.slice(Math.max(0, at - 400), at);
    const opens = (preceding.match(/\btry\s*\{/g) ?? []).length;
    const closes = (preceding.match(/\}\s*catch\b/g) ?? []).length;
    expect(opens, "the gate sits inside a try block that swallows its result").toBe(closes);
  });
});
