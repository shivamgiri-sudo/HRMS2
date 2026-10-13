import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../../bla-bli-blu-dashboard/bbb-uploads.service.js", () => ({ snapshotSalesBeforeReplace: vi.fn(async () => 0) }));

import { importBlaBliBluOverallSalesBatch } from "../bla-bli-blu-overall-sales-bulk.service.js";

const staged = (row_no: number, data: Record<string, unknown>) => ({ id: `r${row_no}`, row_no, normalized_data: JSON.stringify(data) });
const base = { Campaign: "Inbound", Business: "Real Time Sales", Amount: "1,041" };

function pool(rows: unknown[], existingOrders: string[] = [], existingByDate: Record<string, number> = {}) {
  execute.mockImplementation(async (sql: string) => {
    if (/FROM upload_batch_row\s+WHERE upload_batch_id = \? AND row_status IN/.test(sql)) return [rows];
    if (/FROM process_master/.test(sql)) return [[{ id: "proc-1" }]];
    if (/SELECT order_id FROM bla_bli_blu_overall_sales_raw/.test(sql)) return [existingOrders.map((order_id) => ({ order_id }))];
    if (/COUNT\(\*\) AS n FROM bla_bli_blu_overall_sales_raw/.test(sql)) return [Object.entries(existingByDate).map(([d, n]) => ({ d, n }))];
    if (/^\s*SELECT/i.test(sql)) return [[]];
    return [{ affectedRows: 1 }];
  });
}
const calls = (re: RegExp) => execute.mock.calls.filter(([s]) => re.test(String(s)));

beforeEach(() => execute.mockReset());

describe("importBlaBliBluOverallSalesBatch", () => {
  it("imports the valid rows of a mixed file and rejects only the invalid ones, with structured reasons", async () => {
    pool([
      staged(1, { ...base, OrderID: "A", Date: "01-09-26" }),
      staged(2, { ...base, OrderID: "B", Date: "not a date" }),
      staged(3, { ...base, OrderID: "", Date: "02-09-26" }),
      staged(4, { ...base, OrderID: "C", Date: "03-09-26", Amount: "abc" }),
      staged(5, { ...base, "Order ID": "D", Date: "2026-09-04" }),
    ]);
    const r = await importBlaBliBluOverallSalesBatch("batch-1", "user-1");
    expect(r.importedRows).toBe(2);
    expect(r.errorRows).toBe(3);
    expect(r.summary).toMatchObject({ totalRows: 5, acceptedRows: 2, rejectedRows: 3, successPct: 40, rejectionPct: 60, months: ["2026-09"] });

    const insert = calls(/INSERT INTO bla_bli_blu_overall_sales_raw/)[0];
    const values = insert[1] as unknown[];
    expect(values).toContain("A");
    expect(values).toContain("D");
    expect(values).toContain(1041); // "1,041" stored as a number, not NULL

    const rejectInsert = calls(/INSERT INTO bla_bli_blu_sales_upload_reject/)[0];
    const p = rejectInsert[1] as unknown[];
    expect(p).toEqual(expect.arrayContaining(["batch-1", 2, "Date", "not a date", "INVALID_DATE", "business", "reject"]));
    expect(p).toEqual(expect.arrayContaining([3, "OrderID", "MISSING_FIELD"]));
    expect(p).toEqual(expect.arrayContaining([4, "Amount", "abc", "INVALID_NUMBER"]));

    const status = calls(/UPDATE upload_batch SET batch_status/)[0];
    expect(status[1]).toEqual(expect.arrayContaining(["imported_with_errors", 2, 3]));
    const errRows = calls(/UPDATE upload_batch_row SET row_status = 'error'/)[0];
    expect(String((errRows[1] as unknown[])[1])).toContain("INVALID_DATE");
  });

  it("re-imported 1-3 Aug orders update instead of duplicating, and records existing vs new per date", async () => {
    pool(
      [
        staged(1, { ...base, OrderID: "A", Date: "01-08-26" }),
        staged(2, { ...base, OrderID: "B", Date: "01-08-26" }),
        staged(3, { ...base, OrderID: "A", Date: "01-08-26", "Current Status": "RTO" }), // repeated in file: last wins
        staged(4, { ...base, OrderID: "Z", Date: "03-08-26" }),
      ],
      ["A", "B"],
      { "2026-08-01": 3, "2026-08-03": 0 },
    );
    const r = await importBlaBliBluOverallSalesBatch("batch-2", "user-1");
    expect(r.summary).toMatchObject({ acceptedRows: 3, rejectedRows: 1, updatedOrders: 2, newOrders: 1, duplicateInFile: 1 });
    expect(calls(/ON DUPLICATE KEY UPDATE/).length).toBeGreaterThan(0);
    const dates = calls(/INSERT INTO bla_bli_blu_sales_upload_date/)[0][1] as unknown[];
    // batch, date, existing, upload, updated, inserted, after
    expect(dates.slice(0, 6)).toEqual(["batch-2", "2026-08-01", 3, 2, 2, 0]);
    expect(dates.slice(7, 13)).toEqual(["batch-2", "2026-08-03", 0, 1, 0, 1]);
  });

  it("reports a missing process as a technical reject, not a business one", async () => {
    pool([staged(1, { ...base, OrderID: "A", Date: "01-09-26" })]);
    const prev = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, params?: unknown[]) => (/FROM process_master/.test(sql) ? [[]] : prev(sql, params)));
    const r = await importBlaBliBluOverallSalesBatch("batch-3", "user-1");
    expect(r).toMatchObject({ importedRows: 0, errorRows: 1 });
    expect(r.summary).toMatchObject({ technicalRejects: 1, successPct: 0 });
    const p = calls(/INSERT INTO bla_bli_blu_sales_upload_reject/)[0][1] as unknown[];
    expect(p).toEqual(expect.arrayContaining(["PROCESS_NOT_FOUND", "technical"]));
  });
});
