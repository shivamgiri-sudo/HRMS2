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
    if (sql.includes("FROM kpi_score_summary")) return [[{ employee_id: "zeroKpi", scores: "0" }, { employee_id: "scored", scores: "80,70" }], []];
    return [[], []];
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
