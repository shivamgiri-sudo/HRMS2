import { describe, expect, it, vi } from "vitest";

/**
 * openCase() must refuse to open a NOC case before the employee's last working day is reached
 * (owner ruling 2026-09-16: "NOC initiation can be done on and after last date of working").
 *
 * Before this gate, openCase() had no timing check at all — only that the employee exists and
 * no case is already open — so any of the six initiator roles could open a case (and trigger a
 * form-invite email) for someone who hadn't resigned yet, or whose last working day was still
 * weeks away. The automated daily trigger (noc-lwd-trigger.service.ts) already only ever calls
 * openCase() for LWDs that have arrived, so this gate is a no-op for that caller and only closes
 * the gap on the manual "start a NOC" endpoint.
 *
 * Reuses EMPLOYMENT_END_DATE_SELECT — the one shared "when did employment end" resolver payroll
 * itself reads from — rather than a second, narrower definition keyed only on exit_request.
 */

const { dbExecute, getConnectionMock, connExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  getConnectionMock: vi.fn(),
  connExecute: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, query: dbExecute, getConnection: getConnectionMock },
}));

const EMP_ID = "emp-1";

/**
 * Drives the four SELECTs openCase() issues in order before it ever opens a transaction:
 *   1. getCaseByEmployee   -> no existing case
 *   2. loadEmployeeSnapshot -> the employee exists
 *   3. exit_request lookup (only when exitRequestId not supplied) -> some exit request id
 *   4. the new LWD resolver query
 */
function primeDb(lwd: string | null) {
  dbExecute.mockReset();
  dbExecute
    .mockResolvedValueOnce([[]])                                        // 1. no existing case
    .mockResolvedValueOnce([[{ id: EMP_ID, employee_code: "MAS1", full_name: "Test Employee" }]]) // 2. employee snapshot
    .mockResolvedValueOnce([[{ id: "exit-1" }]])                        // 3. exit_request lookup
    .mockResolvedValueOnce([[{ lwd }]]);                                // 4. LWD resolver

  getConnectionMock.mockReset();
  connExecute.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
  getConnectionMock.mockResolvedValue({
    beginTransaction: vi.fn(),
    execute: connExecute,
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  });
}

async function loadService() {
  vi.resetModules();
  return import("../noc-case.service.js");
}

describe("openCase — NOC cannot be initiated before the last working day", () => {
  it("refuses when the employee has no confirmed/proposed last working day yet", async () => {
    const { openCase } = await loadService();
    primeDb(null);

    await expect(
      openCase({ employeeId: EMP_ID, initiatorRole: "hr", initiatedByUserId: "u1" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "NOC_LWD_NOT_KNOWN" });
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it("refuses when the last working day is still in the future", async () => {
    const { openCase } = await loadService();
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    primeDb(future);

    await expect(
      openCase({ employeeId: EMP_ID, initiatorRole: "hr", initiatedByUserId: "u1" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "NOC_LWD_NOT_REACHED" });
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it("allows opening the case once the last working day is today or earlier", async () => {
    const { openCase } = await loadService();
    const today = new Date().toISOString().slice(0, 10);
    primeDb(today);

    const result = await openCase({ employeeId: EMP_ID, initiatorRole: "hr", initiatedByUserId: "u1" });
    expect(result.created).toBe(true);
    expect(getConnectionMock).toHaveBeenCalled();
  });
});
