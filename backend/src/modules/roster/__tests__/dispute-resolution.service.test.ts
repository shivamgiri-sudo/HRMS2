import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, notify } = vi.hoisted(() => ({ execute: vi.fn(), notify: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../roster-requests/roster-requests.notify.js", () => ({ notifyRosterRequest: notify }));

import { resolveDispute } from "../dispute-resolution.service.js";

const row = { id: "rda-1", employee_id: "e1", roster_date: "2026-10-05", cycle_id: "c1", shift_template_id: "t-old", process_id: "p1", branch_id: "b1", cycle_status: "published" };
const allow = async () => true;

beforeEach(() => {
  execute.mockReset();
  notify.mockReset();
  execute.mockImplementation(async (sql: string) => (/SELECT rda\.\*/.test(sql) ? [[row], []] : [{ affectedRows: 1 }, []]));
});

describe("resolveDispute", () => {
  it("400s with the handler's body when the resolution is blank", async () => {
    await expect(resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "  ", canOwn: allow }))
      .rejects.toMatchObject({ statusCode: 400, body: { error: "dispute_resolution is required" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("404s for an unknown assignment", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(resolveDispute({ assignmentId: "x", userId: "u1", resolution: "ok", canOwn: allow }))
      .rejects.toMatchObject({ statusCode: 404, body: { error: "Assignment not found" } });
  });

  it("403s when the caller does not own the roster", async () => {
    await expect(resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "ok", canOwn: async () => false }))
      .rejects.toMatchObject({ statusCode: 403, body: { success: false, message: "Forbidden: roster ownership required to resolve disputes" } });
  });

  it("409s on a locked cycle before writing", async () => {
    execute.mockResolvedValueOnce([[{ ...row, cycle_status: "attendance_locked" }], []]);
    await expect(resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "ok", canOwn: allow }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("applies the new shift, notifies the employee and returns before/after", async () => {
    const r = await resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: " moved ", newShiftTemplateId: "t-new", canOwn: allow });
    const [sql, params] = execute.mock.calls[1];
    expect(sql).toMatch(/shift_template_id = \?/);
    expect(params).toEqual(["u1", expect.any(String), "moved", "t-new", "rda-1"]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: ["e1"], kind: "dispute", sourceId: "rda-1" }));
    expect(r).toMatchObject({ previousShiftTemplateId: "t-old", shiftTemplateId: "t-new", resolution: "moved" });
  });

  it("keeps the original shift when no new shift is given", async () => {
    await resolveDispute({ assignmentId: "rda-1", userId: "u1", resolution: "keep", canOwn: allow });
    const [sql, params] = execute.mock.calls[1];
    expect(sql).not.toMatch(/shift_template_id = \?/);
    expect(params).toEqual(["u1", expect.any(String), "keep", "rda-1"]);
  });
});
