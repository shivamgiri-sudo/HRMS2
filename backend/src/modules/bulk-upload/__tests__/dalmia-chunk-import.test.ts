import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<{ sql: string; params: unknown[] }> = [];
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM upload_batch_row/.test(sql)) {
        const rows = Array.from({ length: 1201 }, (_, i) => ({
          id: `row-${i}`, row_no: i + 2,
          normalized_data: JSON.stringify({ Date: "1-Sep-26 10:00", "Contact No": String(9000000000 + i) }),
        }));
        return [rows];
      }
      if (/FROM process_master/.test(sql)) return [[{ id: "proc-1" }]];
      return [[], undefined];
    }),
  },
}));

import { importDalmiaAfterHourBatch } from "../dalmia-after-hour-bulk.service.js";

describe("Dalmia importers write in chunks", () => {
  beforeEach(() => { calls.length = 0; });

  it("1201 rows -> 3 multi-row inserts, not 1201, and rows are marked imported", async () => {
    const res = await importDalmiaAfterHourBatch("batch-1", "user-1");
    expect(res).toMatchObject({ importedRows: 1201, errorRows: 0 });
    const inserts = calls.filter((c) => /^INSERT INTO dalmia_after_hour_raw/.test(c.sql));
    expect(inserts).toHaveLength(3);
    expect(inserts[0].sql).toContain("ON DUPLICATE KEY UPDATE contact_number = VALUES(contact_number)");
    expect(calls.some((c) => /SET row_status = 'imported'/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /UPDATE upload_batch SET batch_status/.test(c.sql) && c.params[0] === "imported")).toBe(true);
  });
});
