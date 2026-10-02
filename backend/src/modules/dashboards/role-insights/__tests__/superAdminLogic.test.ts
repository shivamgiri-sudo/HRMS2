import { describe, expect, it } from "vitest";
import {
  ageStatus, fillDays, formatAge, gapSeverity, integrationState, isDormant, ratePct, rateStatus,
  systemSignals, systemsHealth, worstStatus, type SystemRow,
} from "../providers/superAdminLogic.js";

const sys = (id: string, status: SystemRow["status"]): SystemRow => ({
  id, name: id, group: "core", status, headline: "h", detail: "d", age_min: null, href: "/x",
});

describe("super admin mission-control logic", () => {
  it("judges freshness by age bands and never green for unknown", () => {
    expect(ageStatus(4, 30, 180)).toBe("ok");
    expect(ageStatus(90, 30, 180)).toBe("warn");
    expect(ageStatus(600, 30, 180)).toBe("down");
    expect(ageStatus(null, 30, 180)).toBe("unknown");
  });

  it("does not indict a service on a tiny sample", () => {
    expect(rateStatus(1, 3, 5, 20)).toBe("ok");
    expect(rateStatus(107, 274, 5, 20)).toBe("down");
    expect(rateStatus(10, 100, 5, 20)).toBe("warn");
    expect(rateStatus(0, 0, 5, 20)).toBe("unknown");
    expect(ratePct(39, 61)).toBe(63.9);
    expect(ratePct(0, 0)).toBeNull();
  });

  it("takes the worst light", () => {
    expect(worstStatus("ok", "warn", "ok")).toBe("warn");
    expect(worstStatus("ok", "down", "warn")).toBe("down");
  });

  it("excludes unprobed systems from the health score instead of padding it", () => {
    const h = systemsHealth([sys("a", "ok"), sys("b", "warn"), sys("c", "down"), sys("d", "unknown")]);
    expect(h.score).toBe(50);
    expect(h.basis).toContain("1 could not be probed");
    expect(systemsHealth([sys("a", "unknown")]).score).toBeNull();
  });

  it("emits signals only from real statuses", () => {
    const s = systemSignals([sys("db", "ok"), sys("email", "down"), sys("bgv", "warn")]);
    expect(s.find((x) => x.title === "email is failing")?.tone).toBe("bad");
    expect(s.find((x) => x.title === "bgv is degraded")?.tone).toBe("watch");
  });

  it("treats a long-dead failed run as dormant, not a live outage", () => {
    const base = { active: true, testOk: null, testAgeDays: null, lastRunStatus: "failed" };
    expect(integrationState({ ...base, lastRunAgeMin: 60 }).state).toBe("down");
    expect(integrationState({ ...base, lastRunAgeMin: 107 * 1440 }).state).toBe("warn");
    expect(integrationState({ ...base, active: false, lastRunAgeMin: 5 }).state).toBe("off");
    expect(integrationState({ active: true, testOk: 0, testAgeDays: 90, lastRunAgeMin: null, lastRunStatus: null }).state).toBe("warn");
    expect(integrationState({ active: true, testOk: null, testAgeDays: null, lastRunAgeMin: null, lastRunStatus: null }).state).toBe("idle");
    expect(integrationState({ active: true, testOk: 1, testAgeDays: 1, lastRunAgeMin: 5, lastRunStatus: "complete" }).state).toBe("ok");
  });

  it("flags dormant privileged accounts", () => {
    expect(isDormant(null, true)).toBe(true);
    expect(isDormant(31, false)).toBe(true);
    expect(isDormant(5, false)).toBe(false);
    expect(isDormant(null, false)).toBe(false);
  });

  it("grades gaps by share and formats ages", () => {
    expect(gapSeverity(0, 1000)).toBe("info");
    expect(gapSeverity(10, 1000)).toBe("normal");
    expect(gapSeverity(50, 1000)).toBe("high");
    expect(gapSeverity(200, 1000)).toBe("critical");
    expect(formatAge(null)).toBe("never");
    expect(formatAge(5)).toBe("5m ago");
    expect(formatAge(180)).toBe("3h ago");
  });

  it("zero-fills quiet days", () => {
    const pts = fillDays(["2026-10-01", "2026-10-02"], new Map([["2026-10-02", { ok: 3 }]]), ["ok", "failed"]);
    expect(pts).toEqual([{ label: "10-01", ok: 0, failed: 0 }, { label: "10-02", ok: 3, failed: 0 }]);
  });
});
