import { describe, expect, it } from "vitest";
import { dedupeSignals, rankSignals, type DedupableSignal } from "../daily-brief-dedup.js";

describe("dedupeSignals", () => {
  it("merges two same-employee-same-issue signals into one, preferring the actionable one", () => {
    const attendanceSignal: DedupableSignal = {
      key: "attn-1",
      label: "Missing punch on 2026-08-18",
      value: 1,
      unit: "count",
      employeeId: "emp-1",
      source: "attendance",
      category: "missing_punch",
      actionUrl: null,
      priority: "medium",
    };
    const actionCentreSignal: DedupableSignal = {
      key: "wi-99",
      label: "Resolve attendance exception",
      value: 1,
      unit: "count",
      employeeId: "emp-1",
      source: "business_action_queue",
      category: "ATTENDANCE_MISMATCH",
      actionUrl: "/action-centre/wi-99",
      priority: "high",
    };

    const result = dedupeSignals([attendanceSignal, actionCentreSignal]);

    expect(result).toHaveLength(1);
    const merged = result[0] as DedupableSignal;
    // actionUrl/priority come from the actionable (Action Centre) signal.
    expect(merged.actionUrl).toBe("/action-centre/wi-99");
    expect(merged.priority).toBe("high");
    // descriptive text from the non-actionable (attendance) signal is not lost.
    expect(merged.label).toContain("Missing punch on 2026-08-18");
    expect(merged.label).toContain("Resolve attendance exception");
  });

  it("does NOT merge two genuinely different issues for the same employee", () => {
    const missingPunch: DedupableSignal = {
      key: "attn-1",
      label: "Missing punch",
      value: 1,
      employeeId: "emp-1",
      category: "missing_punch",
    };
    const lateArrival: DedupableSignal = {
      key: "attn-2",
      label: "Repeated late arrival",
      value: 5,
      employeeId: "emp-1",
      category: "late_arrival_pattern",
    };

    const result = dedupeSignals([missingPunch, lateArrival]);

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.key)).toEqual(["attn-1", "attn-2"]);
  });

  it("never drops a signal with no employeeId — org-level signals are always kept as-is", () => {
    const orgSignal: DedupableSignal = { key: "org-1", label: "Org attendance %", value: 92, category: "attendance_mismatch" };
    const otherOrgSignal: DedupableSignal = { key: "org-2", label: "Another org metric", value: 10, category: "attendance_mismatch" };

    const result = dedupeSignals([orgSignal, otherOrgSignal]);

    expect(result).toHaveLength(2);
  });

  it("does not merge two different employees even if categories match", () => {
    const a: DedupableSignal = { key: "a", label: "A", value: 1, employeeId: "emp-1", category: "missing_punch" };
    const b: DedupableSignal = { key: "b", label: "B", value: 1, employeeId: "emp-2", category: "missing_punch" };

    const result = dedupeSignals([a, b]);

    expect(result).toHaveLength(2);
  });

  it("plain BriefSignal[] (no employeeId/category at all) passes through unmodified", () => {
    const plain = [
      { key: "k1", label: "L1", value: 1, unit: "count" as const },
      { key: "k2", label: "L2", value: 2, unit: "count" as const },
    ];
    const result = dedupeSignals(plain);
    expect(result).toEqual(plain);
  });
});

describe("rankSignals", () => {
  it("puts a critical action before a positive signal", () => {
    const positive: DedupableSignal = {
      key: "pos-1",
      label: "Attendance improved 5%",
      value: 5,
      isPositive: true,
    };
    const criticalAction: DedupableSignal = {
      key: "act-1",
      label: "Approve payroll exception",
      value: 1,
      priority: "critical",
      actionUrl: "/action-centre/1",
      kind: "action",
    };

    const ranked = rankSignals([positive, criticalAction]);

    expect(ranked[0].key).toBe("act-1");
    expect(ranked[1].key).toBe("pos-1");
  });

  it("orders the full priority ladder per spec section 45", () => {
    const informational: DedupableSignal = { key: "info", label: "FYI", value: null, kind: "info" };
    const normalMetric: DedupableSignal = { key: "metric", label: "Headcount", value: 100, kind: "metric" };
    const positive: DedupableSignal = { key: "positive", label: "Great month", value: 1, isPositive: true, kind: "positive" };
    const hygiene: DedupableSignal = { key: "hygiene", label: "Repeated late arrivals", value: 3, kind: "hygiene" };
    const anomaly: DedupableSignal = { key: "anomaly", label: "D-1 attendance drop", value: 1, kind: "anomaly" };
    const businessRisk: DedupableSignal = { key: "risk", label: "Staffing shortfall", value: 1, kind: "business_risk", priority: "critical" };
    const highAction: DedupableSignal = { key: "high-action", label: "Resolve soon", value: 1, kind: "action", priority: "high" };
    const criticalAction: DedupableSignal = { key: "critical-action", label: "Resolve now", value: 1, kind: "action", priority: "critical" };

    const shuffled = [informational, normalMetric, positive, hygiene, anomaly, businessRisk, highAction, criticalAction];
    const ranked = rankSignals(shuffled).map((s) => s.key);

    expect(ranked).toEqual([
      "critical-action",
      "high-action",
      "risk",
      "anomaly",
      "hygiene",
      "positive",
      "metric",
      "info",
    ]);
  });

  it("is a stable sort — equal-rank signals keep their input order", () => {
    const a: DedupableSignal = { key: "a", label: "A", value: 1, category: "z" };
    const b: DedupableSignal = { key: "b", label: "B", value: 1, category: "z" };

    const ranked = rankSignals([a, b]);
    expect(ranked.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const input: DedupableSignal[] = [
      { key: "pos", label: "P", value: 1, isPositive: true },
      { key: "act", label: "A", value: 1, kind: "action", priority: "critical" },
    ];
    const copy = [...input];
    rankSignals(input);
    expect(input).toEqual(copy);
  });
});
