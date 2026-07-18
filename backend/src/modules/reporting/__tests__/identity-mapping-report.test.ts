import { describe, expect, it } from "vitest";
import { buildIdentityMappingExceptionsSql } from "../identity-mapping-report.js";

describe("buildIdentityMappingExceptionsSql", () => {
  it("builds HRMS readiness and snapshot-backed mapping exceptions without live external joins", () => {
    const report = buildIdentityMappingExceptionsSql({}, "2026-07-18");

    expect(report.params).toEqual([]);
    expect(report.sql).toContain("MISSING_BIOMETRIC_CODE");
    expect(report.sql).toContain("MISSING_CALL_CENTRE_CODE");
    expect(report.sql).toContain("EXTERNAL_IDENTITY_UNMATCHED");
    expect(report.sql).toContain("HRMS_MISSING_SOURCE_MAPPING");
    expect(report.sql).toContain("IDENTITY_SNAPSHOT_STALE");
    expect(report.sql).toContain("report_identity_source_snapshot");
    expect(report.sql).not.toContain("PENDING_DATA_BUILDER");
    expect(report.sql).not.toContain("db_masmis.nms_Agent_Details");
    expect(report.sql).not.toContain("Masbiometric.EmployeeDetails");
    expect(report.sql).not.toContain("Shivamgiri.AgentMaster");
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
    expect(report.params).toEqual([
      "branch-1", "process-9",
      "branch-1", "process-9",
      "branch-1", "process-9",
      "branch-1", "process-9",
      "branch-1", "process-9",
      "branch-1", "process-9",
      "branch-1", "process-9",
    ]);
  });
});
