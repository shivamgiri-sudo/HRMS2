import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round 2 governance-matrix finding (2026-08-13): roster-master.service.ts
 * (the 4th roster engine — wrote roster_assignment, which
 * nothing in attendance/payroll read) was the only one of the four
 * real roster-write engines with no attendance/payroll-lock check at all.
 *
 * UPDATED 2026-08-28: the "lower blast radius" caveat this header used to
 * carry no longer applies, and the reason it applied is worth keeping. That
 * engine was the ONLY writer of roster_assignment, and it wrote to a table
 * nothing else read — which is precisely why the table sat at 0 rows while
 * the compliance and analytics engines reading it reported a false 100%
 * all-clear. It now writes wfm_roster_assignment, the single roster source,
 * so this lock guard protects the same table payroll and compliance read.
 * The SQL matchers below follow that rename.
 *
 * The original reasoning still stands on its own terms: "no roster engine
 * should mutate a locked date through an alternative path" doesn't carve out
 * an exception for a lower-traffic one, and the fix was cheap — unlike
 * minimum-rest (which would need shift start/end times this table never
 * stores), the lock check only needs employee_id + date, both already in
 * hand in generateRoster()'s loop.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { rosterMasterService } from "../roster-master.service.js";

const TEMPLATE_ROW = {
  id: "tmpl-1",
  process_id: "proc-1",
  pattern_type: "fixed",
  cycle_days: 1,
  pattern_json: JSON.stringify({ days: [{ day_number: 1, is_week_off: false, shift_template_id: "shift-1" }] }),
  is_active: 1,
};

const BATCH = {
  template_id: "tmpl-1",
  process_id: "proc-1",
  employee_ids: ["emp-1"],
  start_date: "2026-08-17",
  end_date: "2026-08-17",
  apply_preferences: false,
};

beforeEach(() => {
  execute.mockReset();
});

describe("roster-master.service.ts generateRoster — attendance/payroll lock guard", () => {
  it("skips (does not INSERT) an assignment for a date already locked for payroll", async () => {
    let insertCalled = false;
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("SELECT * FROM roster_template")) return [[TEMPLATE_ROW], []];
      if (text.includes("SELECT id FROM wfm_roster_assignment")) return [[], []]; // no existing assignment
      if (text.includes("SELECT is_locked FROM attendance_daily_record")) return [[{ is_locked: 1 }], []];
      if (text.includes("INSERT INTO wfm_roster_assignment")) { insertCalled = true; return [{ affectedRows: 1 }, []]; }
      return [[], []];
    });

    const result = await rosterMasterService.generateRoster(BATCH as any);

    expect(insertCalled).toBe(false);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/emp-1/);
  });

  it("proceeds to INSERT when the date is not locked", async () => {
    let insertCalled = false;
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("SELECT * FROM roster_template")) return [[TEMPLATE_ROW], []];
      if (text.includes("SELECT id FROM wfm_roster_assignment")) return [[], []];
      if (text.includes("SELECT is_locked FROM attendance_daily_record")) return [[{ is_locked: 0 }], []];
      if (text.includes("INSERT INTO wfm_roster_assignment")) { insertCalled = true; return [{ affectedRows: 1 }, []]; }
      return [[], []];
    });

    const result = await rosterMasterService.generateRoster(BATCH as any);

    expect(insertCalled).toBe(true);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("also proceeds when attendance_daily_record has no row for that employee/date at all (nothing to lock against yet)", async () => {
    let insertCalled = false;
    execute.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("SELECT * FROM roster_template")) return [[TEMPLATE_ROW], []];
      if (text.includes("SELECT id FROM wfm_roster_assignment")) return [[], []];
      if (text.includes("SELECT is_locked FROM attendance_daily_record")) return [[], []]; // no row
      if (text.includes("INSERT INTO wfm_roster_assignment")) { insertCalled = true; return [{ affectedRows: 1 }, []]; }
      return [[], []];
    });

    const result = await rosterMasterService.generateRoster(BATCH as any);

    expect(insertCalled).toBe(true);
    expect(result.created).toBe(1);
  });
});
