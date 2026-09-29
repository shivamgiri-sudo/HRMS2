import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The drainer worked a queue row, hit "no run line", and the service inserted a NEW pending row
 * whose reason was the old one plus "; no active salary run line found". The drainer then marked
 * the old row skipped_locked, and the new row was picked up next cycle — forever. Result: one new
 * row per employee-month per cycle, reasons growing to ~16 KB, a 7 GB table.
 *
 * Guarded here: the drainer opts out of re-queueing; every other caller still re-queues; and a
 * run that IS open is recalculated exactly as before (live salary reads salary_prep_line).
 */

const { execute, calc } = vi.hoisted(() => ({ execute: vi.fn(), calc: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../payrollCalculate.service.js", () => ({ calculatePayrollRunScoped: calc }));
vi.mock("../run-status.js", () => ({ isRunClosed: (s: string) => s === "closed" || s === "locked" }));
vi.mock("../../../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { recalculateOpenPayrollForEmployee } = await import("../payroll-targeted-recalculation.service.js");

const base = { employeeId: "e1", payrollMonth: "2026-09", sourceEventType: "cosec_sync", reason: "r" };
const inserts = () => execute.mock.calls.filter(([s]) => /INSERT INTO payroll_recalculation_queue/.test(String(s)));

/** runs = rows returned by the run lookup; line snapshots return one fixed line. */
function stub(runs: Array<{ id: string; status: string }>) {
  execute.mockReset();
  calc.mockReset();
  execute.mockImplementation((sql: string) => {
    const s = String(sql);
    if (/FROM salary_prep_run spr/.test(s)) return Promise.resolve([runs, []]);
    if (/FROM salary_prep_line/.test(s))
      return Promise.resolve([[{ paid_working_days: 30, final_payable_days: 30, net_salary: 1000, gross_salary: 1200 }], []]);
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
}

beforeEach(() => stub([]));

describe("no run line", () => {
  it("default caller still records a queue row (behaviour unchanged)", async () => {
    const r = await recalculateOpenPayrollForEmployee(base);
    expect(r.status).toBe("no_open_run");
    expect(inserts()).toHaveLength(1);
  });

  it("drainer (enqueueOnMiss:false) inserts NOTHING and reports no_open_run", async () => {
    const r = await recalculateOpenPayrollForEmployee({ ...base, enqueueOnMiss: false });
    expect(r.status).toBe("no_open_run");
    expect(inserts()).toHaveLength(0);
    expect(calc).not.toHaveBeenCalled();
  });
});

describe("closed run", () => {
  it("default caller still records it; drainer does not", async () => {
    stub([{ id: "run1", status: "closed" }]);
    await recalculateOpenPayrollForEmployee(base);
    expect(inserts()).toHaveLength(1);

    stub([{ id: "run1", status: "closed" }]);
    const r = await recalculateOpenPayrollForEmployee({ ...base, enqueueOnMiss: false });
    expect(r.status).toBe("queued");
    expect(inserts()).toHaveLength(0);
    expect(calc).not.toHaveBeenCalled();
  });
});

describe("open run — salary path must be untouched", () => {
  it.each([true, false])("recalculates the line with enqueueOnMiss=%s", async (flag) => {
    stub([{ id: "run1", status: "processing" }]);
    const r = await recalculateOpenPayrollForEmployee({ ...base, enqueueOnMiss: flag, actorUserId: "system" });
    expect(r.status).toBe("recalculated");
    expect(calc).toHaveBeenCalledTimes(1);
    expect(calc).toHaveBeenCalledWith("run1", "system", { employeeIds: ["e1"] });
    expect(inserts()).toHaveLength(0);
  });

  it("recalculates every open run and only queues the closed one (default)", async () => {
    stub([{ id: "a", status: "processing" }, { id: "b", status: "processing" }, { id: "c", status: "closed" }]);
    await recalculateOpenPayrollForEmployee(base);
    expect(calc).toHaveBeenCalledTimes(2);
    expect(inserts()).toHaveLength(1);
  });
});

describe("drainer wiring", () => {
  it("source passes enqueueOnMiss:false to the service", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../payroll-recalc-drainer.service.ts", import.meta.url), "utf8");
    expect(src).toMatch(/recalculateOpenPayrollForEmployee\(\{[\s\S]*?enqueueOnMiss:\s*false[\s\S]*?\}\)/);
  });
});
