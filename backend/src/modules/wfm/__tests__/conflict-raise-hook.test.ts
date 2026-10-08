import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ raised: vi.fn(), execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute, getConnection: vi.fn() } }));
vi.mock("../../roster-requests/roster-requests.raise.js", () => ({ onRosterRequestRaised: m.raised }));
vi.mock("../schema-probe.util.js", () => ({ hasTable: async () => true }));
vi.mock("../../roster/weekoff-rule.service.js", () => ({ loadWeekoffRules: vi.fn() }));
vi.mock("../../roster/roster-lock-guard.js", () => ({ checkEmployeeDateNotLocked: vi.fn() }));
vi.mock("../../roster/weekoff-policy.service.js", () => ({ resolveWeekOffScopeDefault: vi.fn() }));
vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({ triggerRosterPublishPending: vi.fn() }));
vi.mock("../roster-offday-apply.js", () => ({ loadPlanOffdayPolicy: vi.fn(), markWeekOff: vi.fn(), stampPlanRows: vi.fn() }));

import { recordRestGapWarning } from "../rest-policy.service.js";
import { insertConflict } from "../auto-roster-synced.service.js";

const warn = { employeeId: "e1", rosterDate: "2026-10-05", actualRestMinutes: 400, requiredRestMinutes: 660, against: "previous" as const };
const conflict = { plan_id: "p1", employee_id: "e1", roster_date: "2026-10-05", conflict_type: "OVERLAP", message: "x" };

beforeEach(() => {
  m.raised.mockReset();
  m.execute.mockReset();
  m.execute.mockResolvedValue([{ affectedRows: 1 }, undefined]);
});

describe("rest-policy REST_GAP_WARNING raise hook", () => {
  it("raises one conflict per inserted row, referencing the inserted id", async () => {
    await recordRestGapWarning(warn);
    const insertedId = (m.execute.mock.calls[0][1] as unknown[])[0];
    expect(m.raised).toHaveBeenCalledTimes(1);
    expect(m.raised).toHaveBeenCalledWith(expect.objectContaining({ kind: "conflict", sourceId: insertedId, employeeId: "e1", date: "2026-10-05" }));
  });
  it("does not raise when nothing was inserted", async () => {
    m.execute.mockResolvedValue([{ affectedRows: 0 }, undefined]);
    await recordRestGapWarning(warn);
    expect(m.raised).not.toHaveBeenCalled();
  });
  it("does not raise when the insert fails, and never throws", async () => {
    m.execute.mockRejectedValue(new Error("db down"));
    await expect(recordRestGapWarning(warn)).resolves.toBeUndefined();
    expect(m.raised).not.toHaveBeenCalled();
  });
  it("a throwing hook never affects the insert result", async () => {
    m.raised.mockImplementation(() => { throw new Error("hook boom"); });
    await expect(recordRestGapWarning(warn)).resolves.toBeUndefined();
    expect(m.execute).toHaveBeenCalledTimes(1);
  });
});

describe("auto-roster insertConflict raise hook", () => {
  it("raises once per inserted row", async () => {
    await insertConflict(conflict);
    expect(m.raised).toHaveBeenCalledTimes(1);
    expect(m.raised).toHaveBeenCalledWith(expect.objectContaining({ kind: "conflict", employeeId: "e1", date: "2026-10-05", sourceId: (m.execute.mock.calls[0][1] as unknown[])[0] }));
  });
  it("does not raise when nothing was inserted or there is no employee", async () => {
    m.execute.mockResolvedValue([{ affectedRows: 0 }, undefined]);
    await insertConflict(conflict);
    m.execute.mockResolvedValue([{ affectedRows: 1 }, undefined]);
    await insertConflict({ ...conflict, employee_id: null });
    expect(m.raised).not.toHaveBeenCalled();
  });
  it("a throwing hook does not fail the insert", async () => {
    m.raised.mockImplementation(() => { throw new Error("hook boom"); });
    await expect(insertConflict(conflict)).resolves.toBeUndefined();
  });
});
