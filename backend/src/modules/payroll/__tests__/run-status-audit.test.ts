/**
 * Every payroll run status change must leave an audit row.
 *
 * PATCH /runs/:id/status is what the UI actually calls to approve, lock and
 * disburse a run — usePayroll.ts, DisbursalManagement.tsx and Payroll.tsx all post
 * there — and updateRunStatus wrote nothing to payroll_calculation_audit or
 * sensitive_action_log. The Payroll Audit Trail screen reads exactly those two
 * tables, so a run could be locked, or marked disbursed, with no record anywhere
 * of who did it or when.
 *
 * approveRunForDisbursement, a second path that also reaches 'disbursed', has
 * always logged. Two routes to the same state, one of them audited, was the gap —
 * and the audited one is not the one the UI uses.
 *
 * Asserted against source rather than by executing the service: updateRunStatus
 * runs a status transition, an UPDATE, a notification fan-out and a leave lapse,
 * and standing all of that up would test the mocks more than the behaviour.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll.service.ts"),
  "utf8",
);

/** Body of updateRunStatus. */
function updateRunStatusBody(): string {
  const start = SERVICE.indexOf("async updateRunStatus(");
  expect(start, "updateRunStatus not found").toBeGreaterThan(-1);
  const end = SERVICE.indexOf("\n  },", start);
  return SERVICE.slice(start, end === -1 ? start + 4000 : end);
}

describe("updateRunStatus records who changed the run", () => {
  const body = updateRunStatusBody();

  it("writes a sensitive-action audit row", () => {
    expect(body).toContain("logSensitiveAction({");
    expect(body).toMatch(/module_key: "payroll"/);
    expect(body).toMatch(/entity_type: "salary_prep_run"/);
  });

  it("attributes the change to the acting user", () => {
    // Not 'system' and not the run's own approved_by — the caller performing the
    // transition is what an audit trail has to answer for.
    expect(body).toMatch(/actor_user_id: userId/);
  });

  it("records the status it moved from as well as to", () => {
    // "locked" alone does not say what was undone. A reviewer needs the prior
    // state to tell a normal progression from a run being reopened.
    expect(body).toMatch(/previous_status: run\.status/);
    expect(body).toMatch(/new_status: input\.status/);
  });

  it("names the action after the status, so lock and disburse are distinguishable", () => {
    expect(body).toMatch(/PAYROLL_RUN_\$\{String\(input\.status\)\.toUpperCase\(\)\}/);
  });

  it("awaits the audit write rather than firing it and forgetting", () => {
    // The notification fan-out below it is deliberately setImmediate; the audit row
    // is not a side effect of the action, it is part of it. If it cannot be
    // recorded, failing the request is the correct outcome.
    expect(body).toMatch(/await logSensitiveAction\(/);
    expect(body).not.toMatch(/void logSensitiveAction\(/);
  });

  it("logs after the UPDATE, so a rejected transition is not recorded as one that happened", () => {
    const updateAt = body.indexOf("UPDATE salary_prep_run SET");
    const auditAt = body.indexOf("logSensitiveAction({");
    expect(updateAt).toBeGreaterThan(-1);
    expect(auditAt).toBeGreaterThan(updateAt);
  });
});
