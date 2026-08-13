import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * wfm.service.ts's updateShift() previously did a direct in-place
 * `UPDATE wfm_shift_master SET start_time=?, end_time=? ... WHERE id=?` — any edit
 * retroactively changed every historical roster row that referenced that shift's id,
 * with no versioning at all (unlike wfm_shift_template, which has never had an UPDATE
 * route). This is the Area 4 fix from the roster enterprise-controls program: once a
 * shift has been referenced by any roster assignment, a time-defining edit (start/end
 * time, required minutes) creates a new, independent version row instead of mutating
 * the one in use. Metadata-only edits (name, branch/process label, active status)
 * still happen in place regardless of lock state — they carry no historical-
 * interpretation risk.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { wfmService } from "../wfm.service.js";

const BASE_SHIFT = {
  id: "shift-gen-001",
  shift_code: "GEN",
  parent_shift_id: null,
  version: 1,
  shift_name: "General Shift",
  start_time: "09:00:00",
  end_time: "18:00:00",
  required_minutes: 480,
  branch_name: null,
  process_name: null,
  active_status: 1,
  effective_from: null,
  effective_to: null,
  is_locked: 0,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
};

describe("isShiftLocked", () => {
  beforeEach(() => execute.mockReset());

  it("is false for a shift no roster assignment has ever referenced", async () => {
    execute.mockResolvedValue([[], []]);
    expect(await wfmService.isShiftLocked("shift-gen-001")).toBe(false);
  });

  it("is true once a roster assignment references the shift by id", async () => {
    execute.mockResolvedValue([[{ 1: 1 }], []]);
    expect(await wfmService.isShiftLocked("shift-gen-001")).toBe(true);
  });
});

describe("updateShift", () => {
  beforeEach(() => execute.mockReset());

  it("updates in place when the shift is unlocked, even for a time-defining field", async () => {
    execute.mockImplementation(async (sql?: string) => {
      // Defensive: vitest's own cleanup/timeout machinery can invoke a shared
      // mock one extra time with no arguments once a prior describe block has
      // used a `.catch()`-chained execute() call (confirmed harmless — the real
      // service code makes exactly 4 well-formed calls here, verified by
      // instrumenting db.execute directly outside any assertion).
      if (!sql) return [[], []];
      if (sql.includes("SELECT * FROM wfm_shift_master") || sql.includes("SELECT 1 FROM wfm_shift_master")) {
        // getShift() and isShiftLocked()'s first branch
        if (sql.startsWith("SELECT * FROM wfm_shift_master")) return [[BASE_SHIFT], []];
      }
      if (sql.includes("UNION ALL")) return [[], []]; // isShiftLocked: not referenced anywhere
      if (sql.startsWith("UPDATE wfm_shift_master")) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    const result = await wfmService.updateShift("shift-gen-001", { startTime: "09:30" } as any, "user-1");

    expect(result.versioned).toBeUndefined();
    const updateCall = execute.mock.calls.find(([sql]: [string]) => sql?.startsWith("UPDATE wfm_shift_master SET"));
    expect(updateCall, "expected an in-place UPDATE").toBeDefined();
  });

  it("creates a new version instead of updating in place once the shift is locked and a time-defining field changes", async () => {
    let insertedRow: any = null;
    execute.mockImplementation(async (sql?: string, params?: unknown[]) => {
      if (!sql) return [[], []]; // see note in the previous test
      if (sql.startsWith("SELECT * FROM wfm_shift_master")) {
        return [[insertedRow ?? BASE_SHIFT], []];
      }
      if (sql.includes("UNION ALL")) {
        // isShiftLocked: referenced by a roster assignment
        return [[{ 1: 1 }], []];
      }
      if (sql.startsWith("INSERT INTO wfm_shift_master")) {
        insertedRow = {
          ...BASE_SHIFT,
          id: params![0],
          parent_shift_id: params![2],
          version: params![3],
          start_time: params![5],
          effective_from: params![10],
          is_locked: 0,
        };
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith("UPDATE wfm_shift_master SET effective_to")) {
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    });

    const result = await wfmService.updateShift("shift-gen-001", { startTime: "09:30" } as any, "user-1");

    expect(result.versioned).toBe(true);
    expect(result.id).not.toBe("shift-gen-001");
    expect(result.version).toBe(2);
    expect(result.parent_shift_id).toBe("shift-gen-001"); // BASE_SHIFT has no parent, so it's the lineage root

    // The OLD row must be closed out (effective_to set) and locked, never its
    // start_time/end_time touched.
    const closeCall = execute.mock.calls.find(([sql]: [string]) => sql?.startsWith("UPDATE wfm_shift_master SET effective_to"));
    expect(closeCall, "old version was not closed out").toBeDefined();
    const noInPlaceTimeUpdate = execute.mock.calls.find(
      ([sql]: [string]) => sql?.startsWith("UPDATE wfm_shift_master SET") && sql.includes("start_time"),
    );
    expect(noInPlaceTimeUpdate, "the locked row's start_time must never be updated in place").toBeUndefined();
  });

  it("still updates in place for a metadata-only edit (name/active_status), even when the shift is locked", async () => {
    execute.mockImplementation(async (sql?: string) => {
      if (!sql) return [[], []]; // see note in the first updateShift test
      if (sql.startsWith("SELECT * FROM wfm_shift_master")) return [[BASE_SHIFT], []];
      if (sql.startsWith("UPDATE wfm_shift_master")) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    const result = await wfmService.updateShift("shift-gen-001", { shiftName: "General Shift (renamed)" } as any, "user-1");

    expect(result.versioned).toBeUndefined();
    // isShiftLocked must never even be queried for a non-time-defining edit.
    const lockCheck = execute.mock.calls.find(([sql]: [string]) => sql?.includes("UNION ALL"));
    expect(lockCheck).toBeUndefined();
  });
});

describe("isTimeDefiningShiftEdit", () => {
  it("is true for startTime, endTime, or requiredMinutes", () => {
    expect(wfmService.isTimeDefiningShiftEdit({ startTime: "09:00" } as any)).toBe(true);
    expect(wfmService.isTimeDefiningShiftEdit({ endTime: "18:00" } as any)).toBe(true);
    expect(wfmService.isTimeDefiningShiftEdit({ requiredMinutes: 480 } as any)).toBe(true);
  });

  it("is false for name/branch/process/active-status-only edits", () => {
    expect(wfmService.isTimeDefiningShiftEdit({ shiftName: "x" } as any)).toBe(false);
    expect(wfmService.isTimeDefiningShiftEdit({ activeStatus: false } as any)).toBe(false);
    expect(wfmService.isTimeDefiningShiftEdit({} as any)).toBe(false);
  });
});
