import { beforeEach, describe, it, expect, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { parseReportDate, importGncAprMasmisBatch } from "../gnc-apr-masmis-bulk.service.js";

describe("parseReportDate", () => {
  it("reads a real ISO sample", () => {
    expect(parseReportDate("2026-05-30")).toBe("2026-05-30");
  });
  it("reads a real M/D/YYYY sample", () => {
    expect(parseReportDate("5/30/2026")).toBe("2026-05-30");
  });
  it("returns null for blank", () => {
    expect(parseReportDate("")).toBeNull();
  });
});

/**
 * These two cases used to read an exported GNC_APR_MASMIS_HEADERS list. 5685a58c0 rebuilt
 * the importer around a flexible column lookup ("USER" or "user_name", "Date" or
 * "report_date", ...) and the list went with it, so the same two facts are asserted where
 * they now live: on what importGncAprMasmisBatch requires of a row and on the column list of
 * the INSERT it issues.
 */
describe("headers", () => {
  const stage = (rows: Array<Record<string, unknown>>) => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM upload_batch_row")) {
        return [rows.map((data, i) => ({ id: `row-${i + 1}`, row_no: i + 1, normalized_data: data })), []];
      }
      return [{ affectedRows: 1 }, undefined];
    });
  };
  const insertCall = () =>
    execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO db_masmis.gnc_apr"));
  const insertColumns = () => {
    const sql = String(insertCall()![0]);
    return sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((c) => c.trim());
  };

  beforeEach(() => execute.mockReset());

  it("names user_name and report_date, the row's required fields", async () => {
    stage([
      { user_name: "Asha", report_date: "2026-05-30" },
      { report_date: "2026-05-30" },          // no agent name
      { user_name: "Ravi" },                  // no report date
      { USER: "Meena", Date: "5/30/2026" },   // the template's own header names
    ]);

    const result = await importGncAprMasmisBatch("batch-1", "user-1");

    expect(result.importedRows).toBe(2);
    expect(result.errorRows).toBe(2);
    expect(result.errors).toEqual([
      'Row 2: "USER" (agent name) and "Date" (report date) are both required',
      'Row 3: "USER" (agent name) and "Date" (report date) are both required',
    ]);
    expect(insertColumns()).toEqual(expect.arrayContaining(["user_name", "report_date"]));
    // Both accepted spellings land in the same two columns.
    const values = insertCall()![1] as unknown[];
    expect(values).toEqual(expect.arrayContaining(["Asha", "Meena", "2026-05-30"]));
  });

  it("covers the real live table's full duration-column set, not just the retired subset", async () => {
    const durations = ["aoc", "bio", "bre", "briefing", "down_time", "lunch", "meet", "qa", "sb",
      "tea_break", "training_break", "wash", "tra_qa", "downtime", "capping", "login_duration", "logout_time"];
    // Each column gets a distinct value, so a column that is listed but never bound shows up.
    const row: Record<string, unknown> = { user_name: "Asha", report_date: "2026-05-30" };
    // Keyed by the template's own header where the legacy snake_case name is ambiguous: the
    // importer matches headers with punctuation stripped, so "down_time" and "downtime" are the
    // same key to it. The template tells the two apart as "DOWN" and "Downtime".
    const headerFor: Record<string, string> = { down_time: "DOWN", downtime: "Downtime" };
    const expected: Record<string, string> = {};
    durations.forEach((col, i) => {
      expected[col] = `0.${String(i + 1).padStart(3, "0")}`;
      row[headerFor[col] ?? col] = expected[col];
    });
    stage([row]);

    await importGncAprMasmisBatch("batch-1", "user-1");

    const columns = insertColumns();
    const values = insertCall()![1] as unknown[];
    expect(values).toHaveLength(columns.length);
    for (const col of durations) {
      expect(columns, col).toContain(col);
      expect(values[columns.indexOf(col)], col).toBe(expected[col]);
    }
  });
});
