import { describe, expect, it, vi } from "vitest";
import { loadWatchdogConfig, planActions, type BlockerRow, type WatchdogConfig } from "../lock-watchdog.js";

const cfg = (over: Partial<WatchdogConfig> = {}): WatchdogConfig => ({
  mode: "kill", ownUser: "app", ownSchema: "hrms", idleBlockerS: 15, killActive: false,
  activeAgeS: 180, activeWaitS: 25, maxKillsPerSweep: 3, maxKillsPerHour: 30, ...over,
});
const row = (over: Partial<BlockerRow> = {}): BlockerRow => ({
  blockerThread: 100, blockerUser: "app", blockerDb: "hrms", blockerCommand: "Sleep", blockerAgeS: 60,
  blockerState: "RUNNING", blockerQuery: null, waiterThread: 200, waitedS: 20, ...over,
});

describe("planActions", () => {
  it("kills an idle-in-transaction blocker once a waiter has waited long enough", () => {
    const [a] = planActions([row()], cfg());
    expect(a).toMatchObject({ thread: 100, action: "killed" });
    expect(a.reason).toMatch(/idle in transaction/);
  });

  it("leaves short waits alone (normal contention)", () => {
    expect(planActions([row({ waitedS: 3 })], cfg())).toEqual([]);
  });

  it("never kills another user's or another schema's connection", () => {
    expect(planActions([row({ blockerUser: "root" })], cfg())[0].action).toBe("skipped");
    expect(planActions([row({ blockerDb: "other" })], cfg())[0].action).toBe("skipped");
  });

  it("never kills its own connection", () => {
    expect(planActions([row({ blockerThread: 7 })], cfg(), { ownThread: 7 })[0].action).toBe("skipped");
  });

  it("only alerts on an active query by default, however long it has run", () => {
    const [a] = planActions([row({ blockerCommand: "Query", blockerAgeS: 900, waitedS: 40, blockerQuery: "UPDATE t SET x=1" })], cfg());
    expect(a.action).toBe("alerted");
  });

  it("kills an active blocker only with DB_LOCK_KILL_ACTIVE and when old enough", () => {
    const active = row({ blockerCommand: "Query", blockerAgeS: 200, waitedS: 30, blockerQuery: "UPDATE t SET x=1" });
    expect(planActions([active], cfg({ killActive: true }))[0].action).toBe("killed");
    expect(planActions([{ ...active, blockerAgeS: 60 }], cfg({ killActive: true }))[0].action).toBe("alerted");
  });

  it("never kills DDL", () => {
    const [a] = planActions([row({ blockerCommand: "Query", blockerAgeS: 900, waitedS: 99, blockerQuery: "ALTER TABLE t ADD c INT" })], cfg({ killActive: true }));
    expect(a).toMatchObject({ action: "alerted", reason: "DDL is never killed" });
  });

  it("observe mode records what it would do and kills nothing", () => {
    const [a] = planActions([row()], cfg({ mode: "observe" }));
    expect(a.action).toBe("alerted");
    expect(a.reason).toMatch(/would kill/);
  });

  it("off mode does nothing", () => {
    expect(planActions([row()], cfg({ mode: "off" }))).toEqual([]);
  });

  it("groups waiters by blocker: one kill, waiters counted once each", () => {
    const rows = [row({ waiterThread: 1 }), row({ waiterThread: 2, waitedS: 25 }), row({ waiterThread: 2, waitedS: 25 })];
    const plan = planActions(rows, cfg());
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ waiters: 2, maxWaitS: 25, action: "killed" });
  });

  it("caps kills per sweep and per hour, spending them on the longest waits first", () => {
    const many = [1, 2, 3, 4, 5].map((n) => row({ blockerThread: n, waiterThread: 1000 + n, waitedS: 15 + n }));
    const plan = planActions(many, cfg({ maxKillsPerSweep: 2 }));
    expect(plan.filter((p) => p.action === "killed").map((p) => p.thread)).toEqual([5, 4]);
    expect(plan.filter((p) => p.action === "alerted")).toHaveLength(3);
    const hourly = planActions(many, cfg(), { killsThisHour: 29 });
    expect(hourly.filter((p) => p.action === "killed")).toHaveLength(1);
  });
});

describe("loadWatchdogConfig", () => {
  it("defaults to kill mode with conservative thresholds", () => {
    expect(loadWatchdogConfig({ DB_USER: "u", DB_NAME: "d" })).toMatchObject({
      mode: "kill", ownUser: "u", ownSchema: "d", idleBlockerS: 15, killActive: false, maxKillsPerSweep: 3, maxKillsPerHour: 30,
    });
  });
  it("reads overrides and falls back on junk", () => {
    const c = loadWatchdogConfig({ DB_LOCK_WATCHDOG_MODE: "observe", DB_LOCK_IDLE_BLOCKER_S: "9", DB_LOCK_KILL_ACTIVE: "true", DB_LOCK_ACTIVE_AGE_S: "x" });
    expect(c).toMatchObject({ mode: "observe", idleBlockerS: 9, killActive: true, activeAgeS: 180 });
    expect(loadWatchdogConfig({ DB_LOCK_WATCHDOG_MODE: "off" }).mode).toBe("off");
    expect(loadWatchdogConfig({ DB_LOCK_WATCHDOG_MODE: "bogus" }).mode).toBe("kill");
  });
});

import { inferBlockers, readBlockersWithSource } from "../lock-watchdog.js";

type Trx = Parameters<typeof inferBlockers>[0][number];
const trx = (over: Partial<Trx> = {}): Trx => ({
  thread: 1, state: "RUNNING", ageS: 60, waitedS: 0, rowsLocked: 0, rowsModified: 0, query: null, user: "app", db: "hrms", command: "Sleep", ...over,
});

describe("inferBlockers (no performance_schema access)", () => {
  it("pairs a waiter with an older transaction that holds row locks", () => {
    const rows = inferBlockers([
      trx({ thread: 10, ageS: 50, rowsLocked: 3, rowsModified: 1 }),          // holder, idle
      trx({ thread: 20, state: "LOCK WAIT", ageS: 20, waitedS: 18 }),         // waiter
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockerThread: 10, waiterThread: 20, waitedS: 18, blockerCommand: "Sleep" });
  });

  it("ignores transactions that hold nothing, and ones that started after the waiter began waiting", () => {
    const rows = inferBlockers([
      trx({ thread: 10, ageS: 50, rowsLocked: 0, rowsModified: 0 }),          // holds nothing
      trx({ thread: 11, ageS: 5, rowsLocked: 4 }),                            // younger than the wait
      trx({ thread: 20, state: "LOCK WAIT", ageS: 30, waitedS: 25 }),
    ]);
    expect(rows).toEqual([]);
  });

  it("never treats a waiter as a holder, and returns nothing when nobody waits", () => {
    expect(inferBlockers([trx({ thread: 10, ageS: 50, rowsLocked: 3 })])).toEqual([]);
    expect(inferBlockers([trx({ thread: 20, state: "LOCK WAIT", ageS: 30, waitedS: 25, rowsLocked: 2 })])).toEqual([]);
  });

  it("feeds planActions: an idle inferred holder is killed, an active one is only alerted", () => {
    const idle = inferBlockers([trx({ thread: 10, ageS: 90, rowsLocked: 2 }), trx({ thread: 20, state: "LOCK WAIT", ageS: 40, waitedS: 20 })]);
    expect(planActions(idle, cfg())[0].action).toBe("killed");
    const active = inferBlockers([trx({ thread: 10, ageS: 90, rowsLocked: 2, command: "Query", query: "UPDATE t SET a=1" }), trx({ thread: 20, state: "LOCK WAIT", ageS: 40, waitedS: 20 })]);
    expect(planActions(active, cfg())[0].action).toBe("alerted");
  });
});

describe("readBlockersWithSource", () => {
  it("falls back to information_schema when performance_schema is denied, and says so", async () => {
    const denied = Object.assign(new Error("SELECT command denied to user 'app' for table 'data_lock_waits'"), { errno: 1142 });
    const query = vi.fn()
      .mockRejectedValueOnce(denied)
      .mockResolvedValueOnce([[
        { thread: 10, state: "RUNNING", age_s: 50, waited_s: null, rows_locked: 2, rows_modified: 1, query: null, user: "app", db: "hrms", command: "Sleep" },
        { thread: 20, state: "LOCK WAIT", age_s: 20, waited_s: 18, rows_locked: 0, rows_modified: 0, query: "UPDATE t", user: "app", db: "hrms", command: "Query" },
      ], []]);
    const r = await readBlockersWithSource({ query } as never);
    expect(r.source).toBe("information_schema");
    expect(r.note).toMatch(/denied/);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].blockerThread).toBe(10);
  });

  it("uses the exact source when it is allowed", async () => {
    const query = vi.fn().mockResolvedValueOnce([[], []]);
    expect((await readBlockersWithSource({ query } as never)).source).toBe("performance_schema");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
