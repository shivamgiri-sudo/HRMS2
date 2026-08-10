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
    expect(result.failedSources).toEqual([]);
  });

  it("keeps loading readable sources when one source is unreadable, instead of aborting", async () => {
    // The first source (Masbiometric) is denied to the app DB user in production. Before this
    // guard, that ER_TABLEACCESS_DENIED_ERROR took the whole sync down and left the snapshot empty.
    const execute = vi.fn(async (sql: string) => {
      if (/Masbiometric\.EmployeeDetails/.test(sql) || /db_masmis\.nms_Agent_Details/.test(sql)) {
        const e = new Error("SELECT command denied") as Error & { code?: string };
        e.code = "ER_TABLEACCESS_DENIED_ERROR";
        throw e;
      }
      return [{ affectedRows: 5 }];
    });

    const result = await runIdentitySourceSnapshotSync({ execute }, "run-2", "2026-07-19 10:00:00");

    // Still attempts the reset + all 4 sources; the two readable ones load, the two denied ones
    // are recorded rather than throwing.
    expect(execute).toHaveBeenCalledTimes(5);
    expect(result.sources).toHaveLength(4);
    expect(result.failedSources).toEqual(["MASBIOMETRIC_EMPLOYEE", "MASMIS_AGENT"]);
    expect(result.totalAffectedRows).toBe(10); // only the 2 readable sources (SHIVAMGIRI_*), 5 each
    const shivamgiriEmployee = result.sources.find((s) => s.sourceSystem === "SHIVAMGIRI_EMPLOYEE");
    expect(shivamgiriEmployee).toMatchObject({ affectedRows: 5 });
    expect(shivamgiriEmployee?.error).toBeUndefined();
  });
});
