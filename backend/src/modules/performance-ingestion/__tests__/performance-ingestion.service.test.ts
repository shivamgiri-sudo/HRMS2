import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { performanceIngestionService } from "../performance-ingestion.service.js";
import { readPerformanceSourceRows } from "../performance-source-adapters.js";

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock("../performance-source-adapters.js", () => ({
  readPerformanceSourceRows: vi.fn(),
}));

vi.mock("../performance-publication.service.js", () => ({
  publishPerformanceFacts: vi.fn(),
}));

const { db } = await import("../../../db/mysql.js");

function rows<T extends RowDataPacket>(items: T[]) {
  return [items, []] as never;
}

function okHeader(insertId = 0) {
  return [{ insertId } as ResultSetHeader, []] as never;
}

describe("performanceIngestionService manual uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the uploaded filename to the source reader during preview", async () => {
    const execute = vi.mocked(db.execute);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM performance_source_dataset")) {
        return rows([{
          id: "dataset-1",
          dataset_key: "manual_quality",
          dataset_name: "Manual quality",
          source_type: "csv",
          connector_key: null,
          source_entity: "manual-quality.csv",
          process_id: "process-1",
          branch_id: "branch-1",
          timezone_name: "Asia/Kolkata",
          config_json: JSON.stringify({ maxRows: 10 }),
          mapping_json: JSON.stringify({
            employeeIdentifierField: "employee_code",
            eventDateField: "score_date",
            sourceRecordKeyField: "audit_id",
            sourceEventTimestampField: "updated_at",
            metrics: [{
              metricCode: "QUALITY_SCORE",
              valueField: "quality_score",
              aggregation: "average",
            }],
          }),
          approval_status: "draft",
          active_status: 1,
        }]);
      }
      if (sql.includes("FROM performance_ingestion_run") && sql.includes("status = 'running'")) {
        return rows([]);
      }
      if (sql.includes("FROM performance_ingestion_checkpoint")) {
        return rows([]);
      }
      if (sql.includes("FROM kpi_metric_master")) {
        return rows([{
          id: "metric-1",
          metric_code: "QUALITY_SCORE",
          aggregation_method: "average",
        }]);
      }
      if (sql.includes("FROM performance_mapping_version")) {
        return rows([]);
      }
      if (sql.includes("FROM performance_identity_map")) {
        return rows([{
          employee_id: "employee-1",
          process_id: "process-1",
          branch_id: "branch-1",
        }]);
      }
      if (sql.includes("INSERT INTO performance_raw_record")) {
        return okHeader(1);
      }
      return okHeader();
    });
    vi.mocked(readPerformanceSourceRows).mockResolvedValue([{
      employee_code: "MAS001",
      score_date: "2026-08-01",
      audit_id: "A-1",
      updated_at: "2026-08-01T10:00:00+05:30",
      quality_score: "98.5",
    }]);

    const uploadBuffer = Buffer.from(
      "employee_code,score_date,audit_id,updated_at,quality_score\nMAS001,2026-08-01,A-1,2026-08-01T10:00:00+05:30,98.5\n",
      "utf8",
    );

    await performanceIngestionService.run({
      datasetId: "dataset-1",
      mode: "preview",
      from: "2026-08-01",
      to: "2026-08-01",
      requestedBy: "user-1",
      uploadBuffer,
      sourceFileName: "manual-quality.csv",
    });

    expect(readPerformanceSourceRows).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dataset-1", sourceType: "csv" }),
      expect.objectContaining({
        uploadBuffer,
        sourceFileName: "manual-quality.csv",
      }),
    );
  });
});
