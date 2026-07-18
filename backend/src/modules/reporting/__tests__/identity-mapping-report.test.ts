import { describe, expect, it } from "vitest";
import { buildIdentityMappingExceptionsSql } from "../identity-mapping-report.js";

describe("buildIdentityMappingExceptionsSql", () => {
  it("builds the HRMS identity readiness exceptions without using the pending fallback", () => {
    const report = buildIdentityMappingExceptionsSql({}, "2026-07-18");

    expect(report.params).toEqual([]);
    expect(report.sql).toContain("MISSING_BIOMETRIC_CODE");
    expect(report.sql).toContain("MISSING_CALL_CENTRE_CODE");
    expect(report.sql).toContain("MISSING_PROCESS_MAPPING");
    expect(report.sql).toContain("MISSING_BRANCH_MAPPING");
    expect(report.sql).toContain("MISSING_MANAGER_MAPPING");
    expect(report.sql).not.toContain("PENDING_DATA_BUILDER");
    expect(report.sql).not.toContain("vw_agent_log_all");
  });

  it("adds employee-scoped branch and process filters without interpolating values", () => {
    const report = buildIdentityMappingExceptionsSql({
      branchId: " branch-1 ",
      processId: "process-9",
    });

    expect(report.sql).toContain("e.branch_id = ?");
    expect(report.sql).toContain("e.process_id = ?");
    expect(report.sql).not.toContain("branch-1");
    expect(report.sql).not.toContain("process-9");
    expect(report.params).toEqual(["branch-1", "process-9", "branch-1", "process-9", "branch-1", "process-9", "branch-1", "process-9", "branch-1", "process-9"]);
  });
});