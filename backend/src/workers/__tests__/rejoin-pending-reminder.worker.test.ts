import { describe, it, expect, vi } from "vitest";
import { runRejoinReminderSweep, REMINDER_EVERY_HOURS, MAX_REMINDERS, ESCALATE_AFTER_DAYS } from "../rejoin-pending-reminder.worker.js";

function exec(map: Record<string, unknown[] | Error | { affectedRows: number }>) {
  return {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const key = Object.keys(map).find((k) => sql.includes(k));
      const v = key ? map[key] : [];
      if (v instanceof Error) throw v;
      return [v, []];
    }),
  };
}
const deps = (over: Partial<{ r: boolean; e: boolean }> = {}) => ({
  notifyReminder: vi.fn(async () => over.r ?? true),
  notifyEscalation: vi.fn(async () => over.e ?? true),
});

describe("constants", () => {
  it("nudges at 48h and 96h and escalates at 5 days", () => {
    expect(REMINDER_EVERY_HOURS).toBe(48);
    expect(MAX_REMINDERS).toBe(2);
    expect(ESCALATE_AFTER_DAYS).toBe(5);
  });
});

describe("runRejoinReminderSweep", () => {
  it("sends the next reminder number and advances the counter", async () => {
    const e = exec({
      "reminder_count < ?": [{ id: "r1", reminder_count: 0 }, { id: "r2", reminder_count: 1 }],
      "rejoin_request_escalation x": [],
    });
    const d = deps();
    const out = await runRejoinReminderSweep(e as never, d);
    expect(d.notifyReminder).toHaveBeenNthCalledWith(1, "r1", 1);
    expect(d.notifyReminder).toHaveBeenNthCalledWith(2, "r2", 2);
    const updates = e.execute.mock.calls.filter(([s]) => String(s).includes("UPDATE employee_reactivation_requests"));
    expect(updates).toHaveLength(2);
    expect(String(updates[0]![0])).toMatch(/reminder_count\s*=\s*reminder_count\s*\+\s*1/);
    expect(out).toMatchObject({ reminded: 2, failed: 0 });
  });

  it("advances the counter even when the send fails, so an unreachable approver is bounded", async () => {
    const e = exec({ "reminder_count < ?": [{ id: "r1", reminder_count: 0 }], "rejoin_request_escalation x": [] });
    const d = deps({ r: false });
    const out = await runRejoinReminderSweep(e as never, d);
    expect(e.execute.mock.calls.some(([s]) => String(s).includes("UPDATE employee_reactivation_requests"))).toBe(true);
    expect(out).toMatchObject({ reminded: 0, failed: 1 });
  });

  it("a throwing notifier is counted as failed, never aborts the sweep", async () => {
    const e = exec({ "reminder_count < ?": [{ id: "r1", reminder_count: 0 }, { id: "r2", reminder_count: 0 }], "rejoin_request_escalation x": [] });
    const d = { notifyReminder: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(true), notifyEscalation: vi.fn(async () => true) };
    const out = await runRejoinReminderSweep(e as never, d);
    expect(d.notifyReminder).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ reminded: 1, failed: 1 });
  });

  it("escalates a stale request exactly once, only if it wins the claim", async () => {
    const e = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("reminder_count < ?")) return [[], []];
        if (sql.includes("rejoin_request_escalation x")) return [[{ id: "r9" }, { id: "r10" }], []];
        if (sql.includes("INSERT IGNORE INTO rejoin_request_escalation")) {
          // r9 claim wins, r10 was already claimed by another worker
          const calls = e.execute.mock.calls.filter(([s]) => String(s).includes("INSERT IGNORE INTO rejoin_request_escalation")).length;
          return [{ affectedRows: calls === 1 ? 1 : 0 }, []];
        }
        return [[], []];
      }),
    };
    const d = deps();
    const out = await runRejoinReminderSweep(e as never, d);
    expect(d.notifyEscalation).toHaveBeenCalledTimes(1);
    expect(d.notifyEscalation).toHaveBeenCalledWith("r9");
    expect(out.escalated).toBe(1);
  });

  it("selects only pending requests created after the rollout floor", async () => {
    const e = exec({ "reminder_count < ?": [], "rejoin_request_escalation x": [] });
    await runRejoinReminderSweep(e as never, deps());
    const q = e.execute.mock.calls.find(([s]) => String(s).includes("reminder_count < ?"))!;
    expect(String(q[0])).toMatch(/status\s*=\s*'pending'/);
    expect(String(q[0])).toMatch(/created_at\s*>=\s*\?/);
    expect(q[1]![0]).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("a failing query is reported, not thrown", async () => {
    const e = exec({ "reminder_count < ?": new Error("db gone") });
    await expect(runRejoinReminderSweep(e as never, deps())).resolves.toMatchObject({ reminded: 0 });
  });
});
