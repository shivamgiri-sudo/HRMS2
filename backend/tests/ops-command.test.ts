import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import router from "../src/modules/operations/ops-command.routes.js";
import { derive } from "../src/modules/operations/ops-command.service.js";
import { exitedIn, groupKey, isActiveAt, type DimEmp } from "../src/modules/operations/ops-command.dim.js";
import { memo, clearOpsCache } from "../src/modules/operations/ops-command.cache.js";
import { OPS_METRICS } from "../src/modules/operations/ops-command.definitions.js";
import { addDays, daysBetween, previousPeriod, pct } from "../src/modules/operations/ops-command.context.js";

const emp = (over: Partial<DimEmp> = {}): DimEmp => ({
  id: "e1", code: "C1", name: "A", branch: "b1", process: "p1", lob: null, mgr: "m1",
  doj: "2026-01-01", exit: null, leaving: null, active: 1, status: "active", ...over,
});

describe("Operations Command — canonical formulas", () => {
  it("attendance and shrinkage share one denominator (scheduled days)", () => {
    // 100 scheduled, 10 leave, 60 present, 10 half, 10 absent, 10 missing punch
    const m = derive({ scheduled_days: 100, leave_days: 10, present_days: 60, half_days: 10, absent_days: 10, missing_punch_days: 10, worked_days: 70, late_marks: 7 }, 30);
    expect(m.attendance_pct).toBeCloseTo(((60 + 5) / 90) * 100, 1);
    expect(m.shrinkage_pct).toBeCloseTo(((10 + 10 + 10 + 5) / 100) * 100, 1); // 35
    expect(m.planned_shrinkage_pct).toBe(10);
    expect(m.unplanned_shrinkage_pct).toBeCloseTo(25, 1);
    expect(m.missing_punch_pct).toBe(10);
    expect(m.absence_shrinkage_pct).toBe(15);
    // planned + unplanned == total
    expect((m.planned_shrinkage_pct as number) + (m.unplanned_shrinkage_pct as number)).toBeCloseTo(m.shrinkage_pct as number, 1);
    expect(m.late_pct).toBe(10);
  });

  it("attrition = exits / average HC, annualised by period length, hidden for tiny groups", () => {
    const big = derive({ hc_opening: 90, hc_closing: 110, exits: 10, exits_0_30: 2, exits_31_90: 3 }, 30);
    expect(big.hc_avg).toBe(100);
    expect(big.attrition_pct).toBe(10);
    expect(big.attrition_annualised_pct).toBeCloseTo(121.7, 1);
    expect(big.early_attrition_pct).toBe(50);
    const tiny = derive({ hc_opening: 1, hc_closing: 0, exits: 1 }, 30);
    expect(tiny.attrition_pct).toBeNull();
  });

  it("mandate gap and fill", () => {
    const m = derive({ hc_opening: 80, hc_closing: 90, mandate_hc: 100, notice_hc: 4 }, 30);
    expect(m.mandate_gap).toBe(10);
    expect(m.mandate_fill_pct).toBe(90);
    expect(m.backfill_need).toBe(14);
  });

  it("no attendance data stays null, not zero", () => {
    const m = derive({ hc_opening: 5, hc_closing: 5 }, 30);
    expect(m.attendance_pct).toBeUndefined();
    expect(m.shrinkage_pct).toBeUndefined();
  });

  it("every metric id is unique and has a formula", () => {
    const ids = OPS_METRICS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of OPS_METRICS) expect(d.formula.length).toBeGreaterThan(10);
  });
});

describe("Operations Command — employee view rules", () => {
  it("active-at honours both exit columns and future exits", () => {
    expect(isActiveAt(emp(), "2026-09-01")).toBe(true);
    expect(isActiveAt(emp({ doj: "2026-09-10" }), "2026-09-01")).toBe(false);
    expect(isActiveAt(emp({ active: 0, exit: "2026-08-15" }), "2026-09-01")).toBe(false);
    expect(isActiveAt(emp({ active: 0, leaving: "2026-08-15" }), "2026-09-01")).toBe(false);
    expect(isActiveAt(emp({ active: 1, exit: "2026-09-20" }), "2026-09-01")).toBe(true); // serving notice
    expect(isActiveAt(emp({ status: "not_joined" }), "2026-09-01")).toBe(false);
    expect(isActiveAt(emp({ active: 0 }), "2026-09-01")).toBe(false);
  });

  it("exit window uses date_of_exit else date_of_leaving", () => {
    expect(exitedIn(emp({ exit: "2026-09-05" }), "2026-09-01", "2026-09-30")).toBe(true);
    expect(exitedIn(emp({ leaving: "2026-09-05" }), "2026-09-01", "2026-09-30")).toBe(true);
    expect(exitedIn(emp({ exit: "2026-08-31" }), "2026-09-01", "2026-09-30")).toBe(false);
    expect(exitedIn(emp(), "2026-09-01", "2026-09-30")).toBe(false);
  });

  it("group keys fall back to the none sentinel", () => {
    expect(groupKey(emp({ branch: null }), "branch")).toBe("__none__");
    expect(groupKey(emp(), "manager")).toBe("m1");
    expect(groupKey(emp(), "all")).toBe("all");
    expect(groupKey(emp(), "employee")).toBe("e1");
  });
});

describe("Operations Command — periods and cache", () => {
  it("previous period is the same length immediately before", () => {
    expect(previousPeriod({ from: "2026-09-01", to: "2026-09-30" })).toEqual({ from: "2026-08-02", to: "2026-08-31" });
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(30);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(pct(1, 0)).toBeNull();
  });

  it("memo coalesces concurrent loads and serves the cached value", async () => {
    clearOpsCache();
    const fn = vi.fn(async () => "v");
    const [a, b] = await Promise.all([memo("k", fn), memo("k", fn)]);
    expect([a, b]).toEqual(["v", "v"]);
    await memo("k", fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("memo serves stale immediately and refreshes behind the scenes", async () => {
    clearOpsCache();
    let n = 0;
    const fn = async () => ++n;
    expect(await memo("s", fn, 0)).toBe(1); // ttl 0 => immediately stale
    expect(await memo("s", fn, 0)).toBe(1); // stale value returned…
    await new Promise((r) => setTimeout(r, 20));
    expect(await memo("s", fn, 0)).toBe(2); // …and the refresh landed
  });
});

// Mount only this module's router: the gate must hold without depending on the rest of the app.
const app = express().use("/api/operations-command", router);

describe("Operations Command — route gate", () => {
  it("rejects anonymous callers", async () => {
    for (const path of ["summary", "insights", "records?domain=exits", "export?columns=hc_closing", "employee/x/days"]) {
      const res = await request(app).get(`/api/operations-command/${path}`);
      expect(res.status).toBe(401);
    }
  });

  it("rejects roles outside the operations set", async () => {
    const res = await request(app).get("/api/operations-command/summary").set("Authorization", "Bearer mock-token-employee");
    expect([401, 403]).toContain(res.status);
  });
});
