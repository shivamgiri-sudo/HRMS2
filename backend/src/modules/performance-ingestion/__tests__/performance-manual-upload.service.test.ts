import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildManualUploadTemplate,
  inspectManualUploadFile,
  requiredColumnsForMapping,
} from "../performance-manual-upload.service.js";
import type { PerformanceDataset } from "../performance-ingestion.types.js";

function dataset(overrides: Partial<PerformanceDataset> = {}): PerformanceDataset {
  return {
    id: "dataset-1",
    datasetKey: "manual_quality",
    datasetName: "Manual quality",
    sourceType: "csv",
    connectorKey: null,
    sourceEntity: "manual_quality.csv",
    processId: "process-1",
    branchId: "branch-1",
    timezoneName: "Asia/Kolkata",
    config: { maxRows: 100 },
    mapping: {
      employeeIdentifierField: "employee_code",
      eventDateField: "score_date",
      sourceRecordKeyField: "audit_id",
      sourceEventTimestampField: "updated_at",
      metrics: [
        {
          metricCode: "QUALITY_SCORE",
          valueField: "quality_score",
          aggregation: "average",
        },
      ],
    },
    approvalStatus: "active",
    activeStatus: true,
    ...overrides,
  };
}

function csv(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function excelBuffer(rows: Array<Record<string, unknown>>, sheetName = "Performance"): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("manual performance upload inspection", () => {
  it("accepts a valid CSV and reports deterministic evidence", () => {
    const inspection = inspectManualUploadFile(
      dataset(),
      csv("employee_code,score_date,audit_id,updated_at,quality_score\nMAS001,2026-07-01,A-1,2026-07-01T10:00:00Z,98.5\n"),
      "quality.csv",
    );

    expect(inspection.rowCount).toBe(1);
    expect(inspection.columns).toEqual([
      "employee_code",
      "score_date",
      "audit_id",
      "updated_at",
      "quality_score",
    ]);
    expect(inspection.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(inspection.warnings).toEqual([]);
    expect(new Date(inspection.rows[0]?.score_date as string).toISOString().slice(0, 10))
      .toBe("2026-07-01");
  });

  it("rejects a file when a mapped metric column is missing", () => {
    expect(() => inspectManualUploadFile(
      dataset(),
      csv("employee_code,score_date,audit_id,updated_at\nMAS001,2026-07-01,A-1,2026-07-01T10:00:00Z\n"),
      "quality.csv",
    )).toThrow(/quality_score/);
  });

  it("rejects duplicate headers case-insensitively", () => {
    expect(() => inspectManualUploadFile(
      dataset(),
      csv("employee_code,EMPLOYEE_CODE,score_date,audit_id,updated_at,quality_score\nMAS001,MAS001,2026-07-01,A-1,2026-07-01T10:00:00Z,99\n"),
      "quality.csv",
    )).toThrow(/Duplicate header columns/);
  });

  it("rejects silent row truncation when the configured maximum is exceeded", () => {
    const limited = dataset({ config: { maxRows: 1 } });
    expect(() => inspectManualUploadFile(
      limited,
      csv("employee_code,score_date,audit_id,updated_at,quality_score\nMAS001,2026-07-01,A-1,2026-07-01T10:00:00Z,98\nMAS002,2026-07-01,A-2,2026-07-01T10:00:00Z,97\n"),
      "quality.csv",
    )).toThrow(/exceeding the configured maximum/);
  });

  it("rejects Excel content for a CSV dataset", () => {
    const buffer = excelBuffer([
      { employee_code: "MAS001", score_date: "2026-07-01", audit_id: "A-1", updated_at: "2026-07-01T10:00:00Z", quality_score: 99 },
    ]);
    expect(() => inspectManualUploadFile(dataset(), buffer, "quality.csv"))
      .toThrow(/plain-text CSV/);
  });

  it("requires the configured worksheet for Excel datasets", () => {
    const excelDataset = dataset({
      sourceType: "excel",
      config: { maxRows: 100, sheetName: "Approved Data" },
    });
    const buffer = excelBuffer([
      { employee_code: "MAS001", score_date: "2026-07-01", audit_id: "A-1", updated_at: "2026-07-01T10:00:00Z", quality_score: 99 },
    ], "Wrong Sheet");

    expect(() => inspectManualUploadFile(excelDataset, buffer, "quality.xlsx"))
      .toThrow(/Approved Data was not found/);
  });

  it("accepts a valid configured Excel worksheet", () => {
    const excelDataset = dataset({
      sourceType: "excel",
      config: { maxRows: 100, sheetName: "Approved Data" },
    });
    const buffer = excelBuffer([
      { employee_code: "MAS001", score_date: "2026-07-01", audit_id: "A-1", updated_at: "2026-07-01T10:00:00Z", quality_score: 99 },
    ], "Approved Data");

    const inspection = inspectManualUploadFile(excelDataset, buffer, "quality.xlsx");
    expect(inspection.sheetName).toBe("Approved Data");
    expect(inspection.rowCount).toBe(1);
  });

  it("builds the governed template in mapping order", () => {
    const required = requiredColumnsForMapping(dataset().mapping);
    expect(required).toEqual(["employee_code", "score_date", "audit_id", "updated_at", "quality_score"]);
    expect(buildManualUploadTemplate(dataset()))
      .toBe("employee_code,score_date,audit_id,updated_at,quality_score\r\n");
  });
});
