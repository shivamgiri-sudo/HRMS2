import { describe, expect, it, vi } from "vitest";
import { notifyRosterRequest } from "../roster-requests.notify.js";

function fakeExec() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return [[{ user_id: "u-" + params[0] }], []] as any;
    }),
  };
}

describe("notifyRosterRequest", () => {
  it("writes one inbox item per distinct employee user", async () => {
    const exec = fakeExec();
    await notifyRosterRequest(
      { employeeIds: ["e1", "e1", "e2"], kind: "swap", sourceId: "s1", title: "Swap approved", description: "Your swap on 2026-10-05 was approved." },
      exec as any,
    );
    const inserts = exec.calls.filter((c) => c.sql.includes("INSERT INTO work_inbox_item"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params).toContain("ROSTER_REQUEST_DECIDED");
  });

  it("never throws when the DB fails", async () => {
    const exec = { execute: vi.fn(async () => { throw new Error("db down"); }) };
    await expect(
      notifyRosterRequest({ employeeIds: ["e1"], kind: "swap", sourceId: "s1", title: "t", description: "d" }, exec as any),
    ).resolves.toBeUndefined();
  });

  it("does nothing for an empty employee list", async () => {
    const exec = fakeExec();
    await notifyRosterRequest({ employeeIds: [], kind: "swap", sourceId: "s1", title: "t", description: "d" }, exec as any);
    expect(exec.execute).not.toHaveBeenCalled();
  });
});
