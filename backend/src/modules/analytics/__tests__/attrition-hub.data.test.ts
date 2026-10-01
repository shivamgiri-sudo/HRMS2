import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ execute: vi.fn(), inflight: 0, peak: 0 }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute } }));

import { loadSnapshot, today } from "../attrition-hub.data.js";

const person = (id: string) => ({
  id, employee_code: id, name: id, designation_name: "Agent", process_name: "P", branch_name: "B", manager_name: "M",
  designation_id: "d", process_id: "p", branch_id: "b", reporting_manager_id: null, source: "Referral", ctc: 20000,
  join_date: "2025-01-01", exit_date: null, no_pan: 0, no_uan: 0, no_mobile: 0, no_email: 0,
});

beforeEach(() => {
  m.inflight = 0; m.peak = 0;
  m.execute.mockReset().mockImplementation(async (sql: string) => {
    m.inflight++; m.peak = Math.max(m.peak, m.inflight);
    await new Promise((r) => setTimeout(r, 5));
    m.inflight--;
    if (sql.includes("LEFT JOIN designation_master")) return [[person("noKpi"), person("zeroKpi"), person("scored")], []];
    if (sql.includes("FROM wfm_roster_assignment")) return [[
      // newest first per employee: A missed 4 in a row then had turned up before; B missed 2; C turned up yesterday; D never rostered
      ...[1, 1, 1, 1, 0, 1].map((missed) => ({ employee_id: "noKpi", missed })),
      ...[1, 1, 0].map((missed) => ({ employee_id: "zeroKpi", missed })),
      ...[0, 1, 1, 1].map((missed) => ({ employee_id: "scored", missed })),
    ], []];
    if (sql.includes("FROM kpi_score_summary")) return [[{ employee_id: "zeroKpi", scores: "0" }, { employee_id: "scored", scores: "80,70" }], []];
    return [[], []];
  });
});

describe("loadSnapshot (live) - absence streak", () => {
  it("counts consecutive ROSTERED days with no clock-in, newest first, stopping at the first day they came", async () => {
    const snap = await loadSnapshot(today(), { live: true });
    const by = Object.fromEntries(snap.people.map((p) => [p.id, p.features.absentStreak]));
    expect(by.noKpi).toBe(4);
    expect(by.zeroKpi).toBe(2);
    expect(by.scored).toBe(0);
  });
  it("asks the roster, not the raw attendance status, so unrostered people (e.g. trainees) are never counted", async () => {
    await loadSnapshot(today(), { live: true });
    const sqls = m.execute.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((q) => q.includes("FROM wfm_roster_assignment") && q.includes("clock_in_time IS NULL"))).toBe(true);
  });
});

describe("loadSnapshot (live)", () => {
  it("no KPI row, or a KPI of 0 (new joiner not scored yet), means 'no KPI' - never a failing score", async () => {
    const snap = await loadSnapshot(today(), { live: true });
    const by = Object.fromEntries(snap.people.map((p) => [p.id, p.features]));
    expect(by.noKpi.kpiScore).toBeNull();
    expect(by.zeroKpi.kpiScore).toBeNull();
    expect(by.scored.kpiScore).toBe(80);
    expect(by.scored.kpiDelta).toBe(10);
  });

  it("never runs more than 4 source queries at once, and one failing source only degrades that signal", async () => {
    const base = m.execute.getMockImplementation()!;
    m.execute.mockImplementation(async (sql: string, ...rest: unknown[]) => {
      if (sql.includes("FROM leave_request")) throw new Error("boom");
      return base(sql, ...rest);
    });
    const snap = await loadSnapshot(today(), { live: true });
    expect(m.peak).toBeLessThanOrEqual(4);
    expect(snap.degraded).toContain("leave");
    expect(snap.people).toHaveLength(3);
  });
});
