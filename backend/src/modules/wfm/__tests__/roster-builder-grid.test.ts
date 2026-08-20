import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: executeMock } }));

import { getRosterGrid } from "../roster-builder.service.js";

describe("getRosterGrid", () => {
  beforeEach(() => executeMock.mockReset());

  it("returns rows joined with employee and shift template names, filtered by cycleId", async () => {
    executeMock.mockResolvedValueOnce([
      [{
        employee_id: "emp-1", employee_name: "Jane Doe", roster_date: "2026-08-24",
        assignment_id: "assign-1", shift_template_id: "shift-1", shift_template_name: "Day 09-18",
        is_week_off: 0, final_roster_status: "generated",
      }],
      undefined,
    ]);

    const rows = await getRosterGrid({ cycleId: "cycle-1" });

    expect(rows).toEqual([{
      employeeId: "emp-1", employeeName: "Jane Doe", rosterDate: "2026-08-24",
      assignmentId: "assign-1", shiftTemplateId: "shift-1", shiftTemplateName: "Day 09-18",
      isWeekOff: false, finalRosterStatus: "generated",
    }]);
    const [sql, params] = executeMock.mock.calls[0];
    expect(String(sql)).toContain("wra.cycle_id = ?");
    expect(params).toContain("cycle-1");
  });
});
