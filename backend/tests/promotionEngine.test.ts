import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));

import { db } from "../src/db/mysql.js";
import { promoteRows } from "../src/modules/integration-hub/promotionEngine.js";
import type { IntegrationFieldMap } from "../src/modules/integration-hub/integration.types.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const dialerMaps: IntegrationFieldMap[] = [
  { id: "m1", integration_key: "dialer_1", source_field: "emp_id",        target_table: "dialer_session_log", target_column: "employee_code", transform: null, confirmed_by: "u1", confirmed_at: "2026-05-01", active_status: 1, created_at: "2026-05-01" },
  { id: "m2", integration_key: "dialer_1", source_field: "login_date",    target_table: "dialer_session_log", target_column: "session_date",  transform: null, confirmed_by: "u1", confirmed_at: "2026-05-01", active_status: 1, created_at: "2026-05-01" },
  { id: "m3", integration_key: "dialer_1", source_field: "login_minutes", target_table: "dialer_session_log", target_column: "login_minutes", transform: null, confirmed_by: "u1", confirmed_at: "2026-05-01", active_status: 1, created_at: "2026-05-01" },
];

const rawRows = [
  { emp_id: "EMP001", login_date: "2026-05-20", login_minutes: 480 },
  { emp_id: "EMP002", login_date: "2026-05-20", login_minutes: 360 },
];

describe("promoteRows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts one row per source record into target table", async () => {
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await promoteRows("dialer_1", rawRows, dialerMaps, "run-1");
    expect(mockExecute).toHaveBeenCalledTimes(rawRows.length);
    expect(result.promoted).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("maps source_field to target_column correctly", async () => {
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
    await promoteRows("dialer_1", [rawRows[0]], dialerMaps, "run-1");
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/INSERT.*dialer_session_log/i);
    expect(params).toContain("EMP001");
    expect(params).toContain("2026-05-20");
    expect(params).toContain(480);
  });

  it("skips unmapped source fields", async () => {
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
    const rowsWithExtra = [{ emp_id: "EMP001", login_date: "2026-05-20", login_minutes: 480, campaign_id: "C1" }];
    await promoteRows("dialer_1", rowsWithExtra, dialerMaps, "run-1");
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).not.toMatch(/campaign_id/i);
  });

  it("counts failed row when DB throws", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB error"));
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const result = await promoteRows("dialer_1", rawRows, dialerMaps, "run-1");
    expect(result.failed).toBe(1);
    expect(result.promoted).toBe(1);
  });

  it("returns zero promoted for empty rows", async () => {
    const result = await promoteRows("dialer_1", [], dialerMaps, "run-1");
    expect(result.promoted).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("skips rows with no mappable fields", async () => {
    const result = await promoteRows("dialer_1", [{ campaign_id: "C1" }], dialerMaps, "run-1");
    expect(result.promoted).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
