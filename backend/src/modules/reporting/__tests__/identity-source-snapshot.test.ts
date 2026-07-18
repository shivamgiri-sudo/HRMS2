import { describe, expect, it, vi } from "vitest";
import {
  buildIdentitySourceSnapshotReportSql,
  buildIdentitySourceSnapshotSyncStatements,
  runIdentitySourceSnapshotSync,
} from "../identity-source-snapshot.js";

describe("identity source snapshot SQL", () => {
  it("builds source sync statements for the known identity systems", () => {
    const statements = buildIdentitySourceSnapshotSyncStatements("run-1", "2026-07-19 10:00:00");

    expect(statements).toHaveLength(4);
    expect(statements.map((s) => s.sourceSystem)).toEqual([
      "MASBIOMETRIC_EMPLOYEE",
      "SHIVAMGIRI_EMPLOYEE",
      "SHIVAMGIRI_AGENT",
      "MASMIS_AGENT",
    ]);
    expect(statements[0].sql).toContain("Masbiometric.EmployeeDetails");
    expect(statements[1].sql).toContain("Shivamgiri.EmployeeDetails");
    expect(statements[2].sql).toContain("Shivamgiri.AgentMaster");
    expect(statements[3].sql).toContain("db_masmis.nms_Agent_Details");
    expect(statements.every((s) => s.params[0] === "run-1")).toBe(true);
  });

  it("builds the report from the local HRMS snapshot table only", () => {
    const report = buildIdentitySourceSnapshotReportSql({ sourceSystem: "MASMIS_AGENT", matchStatus: "unmatched" });

    expect(report.sql).toContain("FROM report_identity_source_snapshot ris");
    expect(report.sql).toContain("ris.source_system = ?");
    expect(report.sql).toContain("ris.match_status = ?");
    expect(report.sql).not.toContain("db_masmis.nms_Agent_Details");
    expect(report.sql).not.toContain("Masbiometric.EmployeeDetails");
    expect(report.params).toEqual(["MASMIS_AGENT", "unmatched"]);
  });

  it("runs statements sequentially and returns inserted row counts", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 7 }]);

    const result = await runIdentitySourceSnapshotSync({ execute }, "run-1", "2026-07-19 10:00:00");

    expect(execute).toHaveBeenCalledTimes(5);
    expect(result.totalAffectedRows).toBe(28);
    expect(result.sources).toHaveLength(4);
    expect(result.sources[0]).toMatchObject({ sourceSystem: "MASBIOMETRIC_EMPLOYEE", affectedRows: 7 });
  });
});
