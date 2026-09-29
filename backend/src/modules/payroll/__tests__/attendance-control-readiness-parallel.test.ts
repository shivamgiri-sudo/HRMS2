/**
 * getControlTower awaited governance readiness only after every gap query finished. It depends
 * only on the run, so it now starts as soon as the run is known. Output must be identical:
 * readiness is the service result, or { error } when it throws, or null with no run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, readiness } = vi.hoisted(() => ({ execute: vi.fn(), readiness: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: vi.fn().mockResolvedValue([[], []]) } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../payroll-governance.service.js", () => ({ payrollGovernanceService: { readiness } }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn() } }));

import { payrollAttendanceControlService as svc } from "../payroll-attendance-control.service.js";

let order: string[] = [];
function mockDb(withRun: boolean) {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (/FROM salary_prep_run\s+WHERE \(\? IS NULL/.test(sql)) {
      order.push("run");
      return [withRun ? [{ id: "run-1", run_month: "2026-08", status: "processing", attendance_snapshot_locked: 0 }] : [], []];
    }
    if (/attendance_daily_record/.test(sql) && /COUNT/.test(sql)) order.push("gapquery");
    await new Promise((r) => setTimeout(r, 2));
    return [[], []];
  });
}

beforeEach(() => { order = []; readiness.mockReset(); });

describe("getControlTower readiness", () => {
  it("returns the governance result and starts it before the gap queries finish", async () => {
    mockDb(true);
    readiness.mockImplementation(async () => { order.push("readiness"); return { runId: "run-1", canCalculate: true }; });
    const out = await svc.getControlTower({ runMonth: "2026-08" } as any);
    expect(out.readiness).toEqual({ runId: "run-1", canCalculate: true });
    expect(order.indexOf("readiness")).toBeLessThan(order.indexOf("gapquery"));
  });

  it("captures a readiness failure as { error } instead of failing the page", async () => {
    mockDb(true);
    readiness.mockRejectedValue(new Error("governance boom"));
    const out = await svc.getControlTower({ runMonth: "2026-08" } as any);
    expect(out.readiness).toEqual({ error: "governance boom" });
  });

  it("is null and never called when there is no run", async () => {
    mockDb(false);
    const out = await svc.getControlTower({ runMonth: "2026-08" } as any);
    expect(out.readiness).toBeNull();
    expect(readiness).not.toHaveBeenCalled();
  });
});
