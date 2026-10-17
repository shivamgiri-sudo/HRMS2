import { describe, expect, it } from "vitest";
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
