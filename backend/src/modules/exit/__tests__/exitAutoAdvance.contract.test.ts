import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract test for the exit auto-advance cron.
 *
 * Verifies that exits are automatically advanced to 'exited' when:
 * 1. Status is notice_active OR terminated
 * 2. LWD confirmed is today or earlier
 * 3. All clearance tasks are cleared, waived, or not_applicable
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { transitionExitStatus } = vi.hoisted(() => ({ transitionExitStatus: vi.fn() }));
vi.mock("../exit.service.js", () => ({ transitionExitStatus }));

const { executeAutoAdvance } = await import("../../../cron/exitAutoAdvance.cron.js");

beforeEach(() => {
  execute.mockReset();
  transitionExitStatus.mockReset();
});

describe("Exit auto-advance cron", () => {
  it("advances exits when LWD past and all tasks cleared", async () => {
    execute.mockResolvedValueOnce([
      [
        { id: "exit-1", employee_id: "emp-1", status: "notice_active" },
        { id: "exit-2", employee_id: "emp-2", status: "terminated" },
      ],
      [],
    ]);
    transitionExitStatus.mockResolvedValue(undefined);

    const result = await executeAutoAdvance();

    expect(result.advanced).toBe(2);
    expect(result.errors).toBe(0);
    expect(transitionExitStatus).toHaveBeenCalledTimes(2);
    expect(transitionExitStatus).toHaveBeenCalledWith(
      "exit-1",
      "exited",
      expect.objectContaining({ userId: "system", userRole: "system" })
    );
    expect(transitionExitStatus).toHaveBeenCalledWith(
      "exit-2",
      "exited",
      expect.objectContaining({ userId: "system", userRole: "system" })
    );
  });

  it("returns empty result when no exits match", async () => {
    execute.mockResolvedValueOnce([[], []]);

    const result = await executeAutoAdvance();

    expect(result.advanced).toBe(0);
    expect(result.errors).toBe(0);
    expect(transitionExitStatus).not.toHaveBeenCalled();
  });

  it("counts errors when transition fails", async () => {
    execute.mockResolvedValueOnce([
      [{ id: "exit-1", employee_id: "emp-1", status: "notice_active" }],
      [],
    ]);
    transitionExitStatus.mockRejectedValueOnce(new Error("Transition failed"));

    const result = await executeAutoAdvance();

    expect(result.advanced).toBe(0);
    expect(result.errors).toBe(1);
  });

  it("continues processing after individual failure", async () => {
    execute.mockResolvedValueOnce([
      [
        { id: "exit-1", employee_id: "emp-1", status: "notice_active" },
        { id: "exit-2", employee_id: "emp-2", status: "notice_active" },
        { id: "exit-3", employee_id: "emp-3", status: "terminated" },
      ],
      [],
    ]);
    transitionExitStatus
      .mockResolvedValueOnce(undefined) // exit-1 succeeds
      .mockRejectedValueOnce(new Error("Transition failed")) // exit-2 fails
      .mockResolvedValueOnce(undefined); // exit-3 succeeds

    const result = await executeAutoAdvance();

    expect(result.advanced).toBe(2);
    expect(result.errors).toBe(1);
    expect(transitionExitStatus).toHaveBeenCalledTimes(3);
  });

  it("queries for exits with LWD <= today and all tasks cleared", async () => {
    execute.mockResolvedValueOnce([[], []]);

    await executeAutoAdvance();

    const query = execute.mock.calls[0][0] as string;
    // Verifies the query shape without coupling to exact whitespace
    expect(query).toMatch(/status IN \('notice_active', 'terminated'\)/i);
    expect(query).toMatch(/last_working_day_confirmed <= CURDATE\(\)/i);
    expect(query).toMatch(/NOT EXISTS/i);
    expect(query).toMatch(/exit_clearance_task/i);
    expect(query).toMatch(/status NOT IN \('cleared', 'waived', 'not_applicable'\)/i);
  });

  it("passes system actor to transitionExitStatus", async () => {
    execute.mockResolvedValueOnce([
      [{ id: "exit-1", employee_id: "emp-1", status: "notice_active" }],
      [],
    ]);
    transitionExitStatus.mockResolvedValue(undefined);

    await executeAutoAdvance();

    expect(transitionExitStatus).toHaveBeenCalledWith("exit-1", "exited", {
      userId: "system",
      userRole: "system",
      name: "Auto-Advance Cron",
    });
  });
});
