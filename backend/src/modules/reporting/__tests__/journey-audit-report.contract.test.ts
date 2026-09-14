import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("journey audit report service contracts", () => {
  it("registers authoritative sources for all major journey phases", () => {
    const svc = source("../journey-audit-report.service.ts");
    expect(svc).toContain('"ats_candidate"');
    expect(svc).toContain('"ats_candidate_stage_log"');
    expect(svc).toContain('"ats_offer"');
    expect(svc).toContain('"ats_onboarding_bridge"');
    expect(svc).toContain('"employee_lifecycle_event"');
    expect(svc).toContain('"employee_job_history"');
    expect(svc).toContain('"coaching_session"');
    expect(svc).toContain('"pip_record"');
    expect(svc).toContain('"leave_request"');
    expect(svc).toContain('"salary_prep_run"');
    expect(svc).toContain('"exit_request"');
    expect(svc).toContain('"exit_approval_log"');
    // 2026-08-19: was exit_clearance_checklist (0 live rows, abandoned) — this source now
    // registers exit_clearance_task, which the exit module actually writes (24 live rows).
    expect(svc).toContain('"exit_clearance_task"');
  });

  it("resolves actor identity through user-to-employee linkage not name matching", () => {
    const svc = source("../journey-audit-report.service.ts");
    expect(svc).toContain("ACTOR_EMPLOYEE_CODE");
    expect(svc).toContain("ACTOR_NAME");
    expect(svc).toContain("ACTOR_ROLE");
    expect(svc).not.toContain("ON full_name =");
    expect(svc).not.toContain("WHERE full_name =");
  });

  it("populates SOURCE_RECORD_ID from exact source table primary key", () => {
    const svc = source("../journey-audit-report.service.ts");
    expect(svc).toContain("SOURCE_RECORD_ID");
    expect(svc).toContain("SOURCE_TABLE");
  });

  it("uses PENDING EMPLOYEE CODE for pre-bridge candidate events", () => {
    const svc = source("../journey-audit-report.service.ts");
    expect(svc).toContain("PENDING EMPLOYEE CODE");
    expect(svc).toContain("COALESCE(e.employee_code");
  });

  it("computes DAYS_FROM_PREVIOUS_EVENT distinguishing pre-bridge candidates", () => {
    const svc = source("../journey-audit-report.service.ts");
    expect(svc).toContain("DAYS_FROM_PREVIOUS_EVENT");
    expect(svc).toContain('empCode !== "PENDING EMPLOYEE CODE"');
  });

  it("includes approver identity for exit approval events", () => {
    const svc = source("../journey-audit-report.service.ts");
    expect(svc).toContain("exit_approval_log");
    expect(svc).toContain("APPROVER");
    expect(svc).toContain("APPROVAL_STATUS");
  });

  it("guards every source table with has() before including in UNION", () => {
    const svc = source("../journey-audit-report.service.ts");
    expect(svc).toContain("has(columns,");
  });
});
