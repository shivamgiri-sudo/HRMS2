import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §17 — a failed POST-COMMIT exit step must become visible retryable work.
 *
 * The core exit transaction is closed and is not reopened by any of this; follow-ups stay
 * outside it deliberately, because holding a DB transaction open across external services is
 * the thing that must not happen. What changes is the OUTCOME of a follow-up failure: it used
 * to be a log line while the exit reported success, which is how ~60 leavers kept live LMS
 * access and nothing surfaced it.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../../../lib/logger.js", () => ({ logger: { error, warn: vi.fn(), info: vi.fn() } }));

const { recordExitFollowUpFailure } = await import("../exit-followup-recovery.js");

const EXIT_ID = "exit-1";
const EMP_ID = "emp-1";

beforeEach(() => {
  execute.mockReset();
  error.mockReset();
});

describe("recordExitFollowUpFailure", () => {
  it("creates a pending work item naming the step, the exit and the reason", async () => {
    execute.mockResolvedValueOnce([[], []]); // no existing item
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]); // insert

    await recordExitFollowUpFailure("ACCESS_DEPROVISION", EXIT_ID, EMP_ID, new Error("LMS unreachable"));

    const insert = execute.mock.calls.find(([s]) => /INSERT INTO work_item/i.test(String(s)));
    expect(insert, "no work_item was created for the failed step").toBeTruthy();
    const params = insert![1] as unknown[];
    expect(params).toContain("EXIT_FOLLOWUP_ACCESS_DEPROVISION");
    expect(params).toContain(EXIT_ID);
    expect(params).toContain("it"); // routed to the team that can actually fix it
    expect(params).toContain("critical");
    // The reason has to travel with it, or whoever picks it up cannot act.
    expect(JSON.stringify(params)).toContain("LMS unreachable");
  });

  it("routes each step to the team that owns it", async () => {
    // Asserted by VALUE, not by column position. This originally read params[4], which broke the
    // moment the insert moved into the shared work-item recorder with a different column order —
    // a positional assertion pins the SQL's shape, not the claim being made.
    const seen: Record<string, string[]> = {};
    for (const step of ["FF_DRAFT_CREATION", "DIRECT_REPORT_REPARENT", "IT_DEPROVISION_DISPATCH"] as const) {
      execute.mockReset();
      execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 1 }, []]);
      await recordExitFollowUpFailure(step, EXIT_ID, EMP_ID, new Error("x"));
      const params = execute.mock.calls.find(([s]) => /INSERT INTO work_item/i.test(String(s)))![1] as string[];
      seen[step] = params.map(String);
    }
    // An unsettled F&F is payroll's, orphaned reports are HR's, access is IT's.
    expect(seen.FF_DRAFT_CREATION).toContain("payroll");
    expect(seen.DIRECT_REPORT_REPARENT).toContain("hr");
    expect(seen.IT_DEPROVISION_DISPATCH).toContain("it");
    // And each must still carry its own step type, so the routing is not just coincidence.
    expect(seen.FF_DRAFT_CREATION).toContain("EXIT_FOLLOWUP_FF_DRAFT_CREATION");
    expect(seen.DIRECT_REPORT_REPARENT).toContain("EXIT_FOLLOWUP_DIRECT_REPORT_REPARENT");
    expect(seen.IT_DEPROVISION_DISPATCH).toContain("EXIT_FOLLOWUP_IT_DEPROVISION_DISPATCH");
  });

  /**
   * work_item carries no unique key beyond its primary key (verified against the live schema),
   * so ON DUPLICATE KEY UPDATE cannot fire on it — the idempotency has to be explicit or a
   * retried exit stacks a new row every attempt and the inbox becomes noise.
   */
  it("updates the open item instead of stacking duplicates when the step fails again", async () => {
    execute.mockResolvedValueOnce([[{ id: "wi-1" }], []]); // an open item already exists
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await recordExitFollowUpFailure("ACCESS_DEPROVISION", EXIT_ID, EMP_ID, new Error("still failing"));

    expect(execute.mock.calls.some(([s]) => /INSERT INTO work_item/i.test(String(s)))).toBe(false);
    const update = execute.mock.calls.find(([s]) => /UPDATE work_item/i.test(String(s)));
    expect(update, "an existing open item should be refreshed").toBeTruthy();
    expect(update![1]).toContain("wi-1");
  });

  it("only reuses an item that is still open — a completed one does not suppress a new failure", async () => {
    execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 1 }, []]);
    await recordExitFollowUpFailure("FF_DRAFT_CREATION", EXIT_ID, EMP_ID, new Error("y"));

    const select = execute.mock.calls.find(([s]) => /SELECT id FROM work_item/i.test(String(s)));
    expect(String(select![0])).toContain("status NOT IN ('completed', 'cancelled')");
  });

  /**
   * Recording a failure must never become one. The exit has already committed by this point,
   * so throwing here would turn "one follow-up step failed" into "the exit call failed",
   * which is worse for the caller and changes nothing about the underlying step.
   */
  it("never throws when the work_item write itself fails", async () => {
    execute.mockRejectedValue(new Error("work_item table is gone"));

    await expect(
      recordExitFollowUpFailure("ACCESS_DEPROVISION", EXIT_ID, EMP_ID, new Error("original"))
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
  });

  it("carries a list of failures, not just a single Error", async () => {
    execute.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([{ insertId: 1 }, []]);
    // deprovisionEmployeeAccess reports a failures[] array rather than throwing.
    await recordExitFollowUpFailure("ACCESS_DEPROVISION", EXIT_ID, EMP_ID, ["lms revoke failed", "leave cleanup failed"]);

    const insert = execute.mock.calls.find(([s]) => /INSERT INTO work_item/i.test(String(s)))!;
    expect(JSON.stringify(insert[1])).toContain("lms revoke failed");
    expect(JSON.stringify(insert[1])).toContain("leave cleanup failed");
  });
});
