import { describe, it, expect, vi, beforeEach } from "vitest";
// tests/setup.ts already mocks src/db/mysql.js globally, so this import yields
// the shared stub. We drive that stub rather than re-mocking the module — a
// second vi.mock of the same specifier does not displace the setup file's.
import { db } from "../../../db/mysql.js";
import { leaveService } from "../leave.service.js";

const executed: Array<{ sql: string; params: unknown[] }> = [];
const recordingExecute = async (sql: string, params: unknown[] = []) => {
  executed.push({ sql, params });
  return [[], []] as any;
};

const conn = {
  beginTransaction: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  rollback: vi.fn(async () => {}),
  release: vi.fn(() => {}),
  execute: vi.fn(recordingExecute),
};

const CC_A = "11111111-1111-4111-8111-111111111111";
const CC_B = "22222222-2222-4222-8222-222222222222";
const DG_A = "33333333-3333-4333-8333-333333333333";

// Plain substring matching, deliberately not a RegExp built from a template
// literal — `\s` inside one is an escape for "s", which silently produces a
// pattern that matches nothing and a test that passes for the wrong reason.
const normalise = (sql: string) => sql.replace(/\s+/g, " ").trim();
const inserts = (table: string) =>
  executed.filter((e) => normalise(e.sql).toUpperCase().startsWith(`INSERT INTO ${table.toUpperCase()}`));
const deletes = (table: string) =>
  executed.filter((e) => normalise(e.sql).toUpperCase().startsWith(`DELETE FROM ${table.toUpperCase()}`));

beforeEach(() => {
  executed.length = 0;
  conn.beginTransaction.mockClear();
  conn.commit.mockClear();
  conn.rollback.mockClear();
  conn.release.mockClear();
  conn.execute.mockReset();
  conn.execute.mockImplementation(recordingExecute);
  (db as any).getConnection = vi.fn(async () => conn);
  (db as any).query = vi.fn(async () => [[], []]);
  (db as any).execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/FROM leave_holiday_master WHERE id = \?/.test(sql)) {
      return [[{ id: params[0], holiday_name: "Independence Day", branch_id: "branch-1" }], []];
    }
    return [[], []];
  });
});

describe("createHoliday persists scope narrowing", () => {
  it("writes a mapping row per cost centre and designation", async () => {
    await leaveService.createHoliday({
      holidayName: "Independence Day",
      holidayDate: "2026-08-15",
      holidayType: "national",
      branchId: "branch-1",
      costCentreIds: [CC_A, CC_B],
      designationIds: [DG_A],
    } as any, "actor-1");

    expect(inserts("holiday_cost_centre_mapping")).toHaveLength(2);
    expect(inserts("holiday_designation_mapping")).toHaveLength(1);
    // Scope must be written on the same transaction as the holiday itself.
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("writes no mapping rows when no scope is given — that is the branch-wide case", async () => {
    await leaveService.createHoliday({
      holidayName: "Republic Day",
      holidayDate: "2027-01-26",
      holidayType: "national",
      branchId: null,
    } as any, null);

    expect(inserts("holiday_cost_centre_mapping")).toHaveLength(0);
    expect(inserts("holiday_designation_mapping")).toHaveLength(0);
    expect(inserts("leave_holiday_master")).toHaveLength(1);
  });

  it("de-duplicates repeated ids so the stored scope is not overstated", async () => {
    await leaveService.createHoliday({
      holidayName: "Diwali",
      holidayDate: "2026-11-08",
      holidayType: "regional",
      branchId: "branch-1",
      costCentreIds: [CC_A, CC_A, CC_B],
      designationIds: [DG_A, DG_A],
    } as any, "actor-1");

    expect(inserts("holiday_cost_centre_mapping")).toHaveLength(2);
    expect(inserts("holiday_designation_mapping")).toHaveLength(1);
  });

  it("rolls back the holiday when a mapping insert fails", async () => {
    conn.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      if (/INSERT INTO\s+holiday_cost_centre_mapping/i.test(sql)) {
        throw new Error("FK violation: cost centre does not exist");
      }
      return [[], []];
    });

    await expect(leaveService.createHoliday({
      holidayName: "Bad scope",
      holidayDate: "2026-08-15",
      holidayType: "national",
      branchId: "branch-1",
      costCentreIds: [CC_A],
    } as any, "actor-1")).rejects.toThrow(/FK violation/);

    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
});

describe("updateHolidayScope replaces scope wholesale", () => {
  it("hard-deletes the old rows before inserting the new ones", async () => {
    await leaveService.updateHolidayScope("holiday-1", {
      costCentreIds: [CC_B],
      designationIds: [],
    }, "actor-1");

    // Hard DELETE, not `is_active = 0`: the engine ignores is_active, so a
    // soft-deleted row would keep the holiday narrowed while matching nobody.
    expect(deletes("holiday_cost_centre_mapping")).toHaveLength(1);
    expect(deletes("holiday_designation_mapping")).toHaveLength(1);
    expect(executed.some((e) => /^UPDATE\s+holiday_/i.test(normalise(e.sql)))).toBe(false);

    expect(inserts("holiday_cost_centre_mapping")).toHaveLength(1);
    expect(inserts("holiday_designation_mapping")).toHaveLength(0);
  });

  it("clearing both arrays widens the holiday back to branch-wide", async () => {
    await leaveService.updateHolidayScope("holiday-1", {
      costCentreIds: [],
      designationIds: [],
    }, "actor-1");

    expect(deletes("holiday_cost_centre_mapping")).toHaveLength(1);
    expect(inserts("holiday_cost_centre_mapping")).toHaveLength(0);
    expect(inserts("holiday_designation_mapping")).toHaveLength(0);
  });

  it("rejects an unknown holiday id", async () => {
    (db as any).execute = vi.fn(async () => [[], []]);
    await expect(leaveService.updateHolidayScope("nope", {
      costCentreIds: [], designationIds: [],
    }, null)).rejects.toThrow("Holiday not found");
  });
});
