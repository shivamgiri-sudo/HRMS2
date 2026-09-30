import { describe, expect, it } from "vitest";
import {
  adaptCase, adaptSummary, fillWeeks, fmtDate, fmtDateTime, fmtPct, pctChange, sortCases, topRecommendation,
} from "@/pages/wfm/roster-command-center/interventions/calc";

const base = { id: "1", employee_id: "e1", generated_at: "2026-09-28 10:05:00", risk_tier: "high", prediction_score: 60 };

describe("interventions calc", () => {
  it("adaptCase keeps code/name, parses JSON string recs and uppercases tier", () => {
    const c = adaptCase({ ...base, employee_code: "MAS1", employee_name: " Asha ", recommendations: '[{"priority":"immediate","owner":"wfm","action":"a","reason":"r"}]', is_overdue: 1 });
    expect(c.employeeCode).toBe("MAS1");
    expect(c.employeeName).toBe("Asha");
    expect(c.riskTier).toBe("HIGH");
    expect(c.recommendations).toHaveLength(1);
    expect(c.overdue).toBe(true);
  });
  it("adaptCase survives bad JSON and unknown tier", () => {
    const c = adaptCase({ ...base, risk_tier: "??", recommendations: "{bad" });
    expect(c.recommendations).toEqual([]);
    expect(c.riskTier).toBe("LOW");
  });
  it("topRecommendation picks most urgent", () => {
    const t = topRecommendation([
      { priority: "this_week", owner: "wfm", action: "x", reason: "" },
      { priority: "immediate", owner: "manager", action: "y", reason: "" },
    ]);
    expect(t?.action).toBe("y");
  });
  it("pctChange is null when previous is 0", () => {
    expect(pctChange(3, 0)).toBeNull();
    expect(pctChange(6, 4)).toBe(50);
  });
  it("action rate is null (not 0%) with no data; retention passes null through", () => {
    const s = adaptSummary({ total_generated: 0, action_taken_count: 0, retained_count: 0, exited_count: 0, pending_count: 0, retention_success_rate: null, avg_days_to_action: null });
    expect(s.actionRate).toBeNull();
    expect(s.retentionRate).toBeNull();
    expect(fmtPct(s.actionRate)).toBe("—");
    const t = adaptSummary({ total_generated: 8, action_taken_count: 2, retained_count: 1, exited_count: 0, pending_count: 7, retention_success_rate: 100, avg_days_to_action: 1.5 });
    expect(t.actionRate).toBe(25);
  });
  it("formats dates DD/MM/YYYY [HH:mm]", () => {
    expect(fmtDate("2026-09-28 10:05:00")).toBe("28/09/2026");
    expect(fmtDateTime("2026-09-28 10:05:00")).toBe("28/09/2026 10:05");
    expect(fmtDate(null)).toBe("—");
  });
  it("fillWeeks zero-fills 12 Monday-start weeks", () => {
    const w = fillWeeks([{ week_start: "2026-09-28", generated: 4, actioned: 1 }], new Date(2026, 8, 30));
    expect(w).toHaveLength(12);
    expect(w[11]).toMatchObject({ week: "2026-09-28", generated: 4, actioned: 1 });
    expect(w[10].generated).toBe(0);
  });
  it("sortCases sorts by tier then stable by name", () => {
    const rows = [adaptCase({ ...base, id: "a", employee_name: "B", risk_tier: "LOW", recommendations: [] }), adaptCase({ ...base, id: "b", employee_name: "A", risk_tier: "CRITICAL", recommendations: [] })];
    expect(sortCases(rows, { key: "tier", dir: "asc" })[0].id).toBe("b");
  });
});
