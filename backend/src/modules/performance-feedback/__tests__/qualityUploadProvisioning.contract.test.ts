import { describe, it, expect, beforeEach, vi } from "vitest";

import { db } from "../../../db/mysql.js";
import { importQualityRows } from "../quality-upload.service.js";

/**
 * A manual quality upload returned one cryptic error per row.
 *
 * mas_hrms.quality_audit does not exist, so every INSERT threw. Each sat in a
 * per-row try/catch, so a 300-row file produced 300 copies of "Table
 * 'mas_hrms.quality_audit' doesn't exist" with imported = 0 - accurate and
 * useless.
 *
 * It fails fast now rather than being provisioned, because the absence is
 * circumstantial:
 *   - nothing in backend or frontend reads quality_audit;
 *   - the data already arrives from db_audit.call_quality_assessment (282,642
 *     rows) through the 'quality_audit' integration POOL, which is a connection
 *     key rather than this table;
 *   - no UI calls the endpoint.
 *
 * Creating it needs a product decision and a dedupe key for its ON DUPLICATE
 * KEY UPDATE, so the route stays and explains itself instead.
 */
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

const ROW = {
  employee_code: "MAS12345",
  call_date: "2026-08-01",
  quality_score: 92,
};

describe("manual quality upload", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("refuses clearly when the table is absent, instead of failing per row", async () => {
    // information_schema lookup returns nothing => table absent
    mockExecute.mockResolvedValue([[], []]);

    await expect(importQualityRows([ROW] as never, "user-1")).rejects.toMatchObject({
      statusCode: 501,
      code: "QUALITY_AUDIT_STORAGE_ABSENT",
    });
  });

  it("names the real source so the reader knows where quality data lives", async () => {
    mockExecute.mockResolvedValue([[], []]);
    await expect(importQualityRows([ROW] as never, "user-1")).rejects.toThrow(
      /db_audit\.call_quality_assessment/
    );
  });

  it("does not attempt a single INSERT when storage is absent", async () => {
    const calls: string[] = [];
    mockExecute.mockImplementation((sql: string) => {
      calls.push(sql);
      return Promise.resolve([[], []]);
    });

    await importQualityRows([ROW] as never, "user-1").catch(() => undefined);

    expect(calls.some((s) => /INSERT INTO quality_audit/i.test(s))).toBe(false);
  });
});
