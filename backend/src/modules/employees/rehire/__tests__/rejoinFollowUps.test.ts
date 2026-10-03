import { describe, it, expect, vi } from "vitest";
import { runRejoinFollowUps, type FollowUpDeps } from "../rejoinFollowUps.js";

function executor(map: Record<string, unknown[] | Error>) {
  return {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}

const employee = { id: "e1", employee_code: "MAS001", full_name: "Asha Rao", branch_id: "b1", user_id: "u9", date_of_joining: "2025-07-15" };
const input = { requestId: "r1", employeeId: "e1", approverId: "bh1", rejoinDate: "2026-09-20" };

function deps(over: Partial<FollowUpDeps> = {}): FollowUpDeps {
  return {
    invalidateAuthContextCache: vi.fn(),
    dispatchJoinProvisioningTasks: vi.fn(async () => undefined),
    ...over,
  };
}
const base = {
  "FROM employees": [employee],
  "UPDATE lms_employee_mapping": [{ affectedRows: 1 }],
  "FROM it_provisioning_request": [{ n: 0 }],
  "INSERT INTO employee_reactivation_audit": [{ affectedRows: 1 }],
};

describe("runRejoinFollowUps", () => {
  it("runs every step and reports all ok", async () => {
    const d = deps();
    const results = await runRejoinFollowUps(executor(base) as never, d, input);
    expect(results.map((r) => [r.step, r.ok])).toEqual([["auth", true], ["lms", true], ["it_provisioning", true]]);
    expect(d.invalidateAuthContextCache).toHaveBeenCalledWith("u9");
    expect(d.dispatchJoinProvisioningTasks).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "e1", employeeCode: "MAS001", employeeName: "Asha Rao", branchId: "b1", actorUserId: "bh1", joiningDate: "2026-09-20",
    }));
  });

  it("reactivates the LMS mapping for this employee", async () => {
    const ex = executor(base);
    await runRejoinFollowUps(ex as never, deps(), input);
    const call = ex.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE lms_employee_mapping"))!;
    expect(String(call[0])).toMatch(/is_active\s*=\s*1/);
    expect(call[1]).toEqual(["e1"]);
  });

  it("flags — does not pretend — when the employee has no login account", async () => {
    const d = deps();
    const ex = executor({ ...base, "FROM employees": [{ ...employee, user_id: null }] });
    const results = await runRejoinFollowUps(ex as never, d, input);
    const auth = results.find((r) => r.step === "auth")!;
    expect(auth.ok).toBe(false);
    expect(auth.detail).toMatch(/no login account/i);
    expect(d.invalidateAuthContextCache).not.toHaveBeenCalled();
  });

  it("skips IT provisioning when a join request is already open", async () => {
    const d = deps();
    const ex = executor({ ...base, "FROM it_provisioning_request": [{ n: 2 }] });
    const results = await runRejoinFollowUps(ex as never, d, input);
    expect(d.dispatchJoinProvisioningTasks).not.toHaveBeenCalled();
    expect(results.find((r) => r.step === "it_provisioning")).toMatchObject({ ok: true, detail: expect.stringMatching(/already open/i) });
  });

  it("one failing step is recorded and the others still run", async () => {
    const d = deps({ dispatchJoinProvisioningTasks: vi.fn(async () => { throw new Error("IT down"); }) });
    const ex = executor({ ...base, "UPDATE lms_employee_mapping": new Error("no such table") });
    const results = await runRejoinFollowUps(ex as never, d, input);
    expect(results.find((r) => r.step === "auth")!.ok).toBe(true);
    expect(results.find((r) => r.step === "lms")).toMatchObject({ ok: false, detail: "no such table" });
    expect(results.find((r) => r.step === "it_provisioning")).toMatchObject({ ok: false, detail: "IT down" });
  });

  it("never throws, even when the employee cannot be loaded", async () => {
    const results = await runRejoinFollowUps(executor({ ...base, "FROM employees": new Error("db gone") }) as never, deps(), input);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.ok === false)).toBe(true);
  });

  it("writes one audit row with the step results, and a failing audit write does not throw", async () => {
    const ex = executor(base);
    await runRejoinFollowUps(ex as never, deps(), input);
    const audit = ex.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO employee_reactivation_audit"))!;
    expect(audit[1]![0]).toBe("r1");
    expect(audit[1]![1]).toBe("bh1");
    expect(JSON.parse(String(audit[1]![3])).steps.map((s: { step: string }) => s.step)).toEqual(["auth", "lms", "it_provisioning"]);

    const failing = executor({ ...base, "INSERT INTO employee_reactivation_audit": new Error("audit down") });
    await expect(runRejoinFollowUps(failing as never, deps(), input)).resolves.toBeDefined();
  });
});
