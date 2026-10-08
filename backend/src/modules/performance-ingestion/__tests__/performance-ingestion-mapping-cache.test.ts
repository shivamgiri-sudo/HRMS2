import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { performanceIngestionService } from "../performance-ingestion.service.js";
import { readPerformanceSourceRows } from "../performance-source-adapters.js";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../performance-source-adapters.js", () => ({ readPerformanceSourceRows: vi.fn() }));
vi.mock("../performance-publication.service.js", () => ({ publishPerformanceFacts: vi.fn() }));

const { db } = await import("../../../db/mysql.js");
const rows = <T extends RowDataPacket>(items: T[]) => [items, []] as never;
const ok = (insertId = 0) => [{ insertId } as ResultSetHeader, []] as never;

describe("performance ingestion per-run mapping memo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a repeated identifier / process once per run and keeps per-row results", async () => {
    const sqls: string[] = [];
    vi.mocked(db.execute).mockImplementation(async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("FROM performance_source_dataset")) {
        return rows([{
          id: "d1", dataset_key: "k1", dataset_name: "n", source_type: "csv", connector_key: null,
          source_entity: "f.csv", process_id: null, branch_id: null, timezone_name: "Asia/Kolkata",
          config_json: "{}",
          mapping_json: JSON.stringify({
            employeeIdentifierField: "code", eventDateField: "d", sourceRecordKeyField: "k",
            externalProcessField: "camp",
            metrics: [{ metricCode: "Q", valueField: "v", aggregation: "average" }],
          }),
          approval_status: "draft", active_status: 1,
        }]);
      }
      if (sql.includes("FROM performance_ingestion_run") && sql.includes("status = 'running'")) return rows([]);
      if (sql.includes("FROM performance_ingestion_checkpoint")) return rows([]);
      if (sql.includes("FROM kpi_metric_master")) return rows([{ id: "m1", metric_code: "Q", aggregation_method: "average" }]);
      if (sql.includes("FROM performance_mapping_version")) return rows([{ id: "mv1" }]);
      if (sql.includes("FROM performance_identity_map")) return rows([]);
      if (sql.includes("FROM employees")) return rows([{ employee_id: "e1", process_id: "p1", branch_id: "b1" }]);
      if (sql.includes("FROM performance_process_map")) return rows([{ process_id: "p2", branch_id: "b2" }]);
      if (sql.includes("INSERT INTO performance_raw_record")) return ok(1);
      return ok();
    });
    vi.mocked(readPerformanceSourceRows).mockResolvedValue([
      { code: "MAS1", d: "2026-08-01", k: "1", camp: "C1", v: "90" },
      { code: "MAS1", d: "2026-08-01", k: "2", camp: "C1", v: "80" },
      { code: "MAS1", d: "2026-08-02", k: "3", camp: "C1", v: "70" },
    ]);

    await performanceIngestionService.run({
      datasetId: "d1", mode: "preview", from: "2026-08-01", to: "2026-08-02", requestedBy: "u",
      uploadBuffer: Buffer.from("x"), sourceFileName: "f.csv",
    });

    const count = (needle: string) => sqls.filter((s) => s.includes(needle)).length;
    // Employee fallback depends only on the identifier: 1 query for 3 rows / 2 dates.
    expect(count("FROM employees")).toBe(1);
    // Identity-map lookup depends on (identifier, date): 2 distinct dates.
    expect(count("FROM performance_identity_map")).toBe(2);
    // Process map depends on (process, date): 2 distinct dates.
    expect(count("FROM performance_process_map")).toBe(2);
  });
});
