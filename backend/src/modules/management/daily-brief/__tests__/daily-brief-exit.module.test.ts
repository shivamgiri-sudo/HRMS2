import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

import { buildExitModule } from "../daily-brief-exit.module.js";

describe("daily-brief-exit: role gating", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue([[{}]]);
  });

  it("branch_head sees only own team's exits (scoped by employee_id IN teamEmployeeIds)", async () => {
    const result = await buildExitModule({ teamEmployeeIds: ["e1", "e2"] }, "branch_head", "2026-08-18");

    expect(result.applicable).toBe(true);
    const scopedCalls = execute.mock.calls.filter(([sql]: [string]) => sql.includes("employee_id IN"));
    expect(scopedCalls.length).toBeGreaterThan(0);
    for (const [, params] of scopedCalls) {
      expect(params).toEqual(expect.arrayContaining(["e1", "e2"]));
    }
  });

  it("a non-HR, non-manager role (e.g. it) gets NOT_APPLICABLE and runs no query", async () => {
    const result = await buildExitModule({ teamEmployeeIds: ["e1"], hrScope: true }, "it", "2026-08-18");

    expect(result.applicable).toBe(false);
    expect(result.resignationsSubmittedD1).toBeNull();
    expect(result.sourceHealth.every((h) => h.state === "NOT_APPLICABLE")).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("hr gets broader scope only when hrScope is explicitly set", async () => {
    const withScope = await buildExitModule({ hrScope: true }, "hr", "2026-08-18");
    expect(withScope.applicable).toBe(true);

    execute.mockClear();
    const withoutScope = await buildExitModule({}, "hr", "2026-08-18");
    expect(withoutScope.applicable).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("branch_head with no teamEmployeeIds gets NOT_APPLICABLE rather than an unscoped query", async () => {
    const result = await buildExitModule({}, "branch_head", "2026-08-18");

    expect(result.applicable).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("daily-brief-exit: error handling", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("a thrown query error yields sourceHealth = ERROR, not a silent zero", async () => {
    execute.mockRejectedValue(new Error("ER_NO_SUCH_TABLE: simulated failure"));

    const result = await buildExitModule({ hrScope: true }, "hr", "2026-08-18");

    expect(result.resignationsSubmittedD1).toBeNull();
    const health = result.sourceHealth.find((h) => h.module === "exit_resignations");
    expect(health?.state).toBe("ERROR");
    expect(health?.detail).toContain("simulated failure");
  });
});
