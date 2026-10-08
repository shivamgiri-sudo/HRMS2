import { describe, it, expect } from "vitest";
import { buildVerdict, DEFAULT_THRESHOLDS, type VerdictInputs } from "../dossierVerdict.js";

const good: VerdictInputs = {
  attendancePct: 96, avgLateMarksPerMonth: 1, kpiMonthsAtTargetPct: 85, kpiMonthsWithData: 10,
  activeWarnings: 0, finalWarnings: 0, openPip: false, priorAbsconding: false, tenureMonths: 14,
};
const v = (o: Partial<VerdictInputs>) => buildVerdict({ ...good, ...o });

describe("buildVerdict", () => {
  it("rates a clean, strong record as strong", () => {
    const r = v({});
    expect(r.rating).toBe("strong");
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.length).toBeLessThanOrEqual(5);
  });

  it("a final warning is weak regardless of numbers", () => {
    const r = v({ finalWarnings: 1, activeWarnings: 1 });
    expect(r.rating).toBe("weak");
    expect(r.reasons.some((x) => x.tone === "bad" && /final warning/i.test(x.text))).toBe(true);
  });

  it("two bad signals are weak", () => {
    expect(v({ attendancePct: 80, avgLateMarksPerMonth: 7 }).rating).toBe("weak");
  });

  it("one bad signal is average", () => {
    expect(v({ attendancePct: 85 }).rating).toBe("average");
  });

  it("no bad but fewer than two good signals is average", () => {
    expect(v({ attendancePct: 92, avgLateMarksPerMonth: 3, kpiMonthsAtTargetPct: 70, tenureMonths: 5 }).rating).toBe("average");
  });

  it("an open PIP and prior absconding count as bad", () => {
    const r = v({ openPip: true, priorAbsconding: true });
    expect(r.rating).toBe("weak");
  });

  it("says insufficient data when there is no attendance and little KPI history", () => {
    const r = v({ attendancePct: null, avgLateMarksPerMonth: null, kpiMonthsAtTargetPct: null, kpiMonthsWithData: 0 });
    expect(r.rating).toBe("insufficient_data");
  });

  it("conduct problems still make it weak even with no performance data", () => {
    const r = v({ attendancePct: null, avgLateMarksPerMonth: null, kpiMonthsAtTargetPct: null, kpiMonthsWithData: 0, finalWarnings: 1 });
    expect(r.rating).toBe("weak");
  });

  it("ignores KPI when fewer than 3 months have data", () => {
    const r = v({ kpiMonthsAtTargetPct: 10, kpiMonthsWithData: 2 });
    expect(r.reasons.some((x) => /kpi/i.test(x.text) && x.tone === "bad")).toBe(false);
  });

  it("uses the supplied thresholds", () => {
    const strict = buildVerdict({ ...good, attendancePct: 96 }, { ...DEFAULT_THRESHOLDS, minAttendancePct: 99 });
    expect(strict.reasons.some((x) => x.tone === "bad" && /attendance/i.test(x.text))).toBe(true);
  });

  it("never returns more than five reasons, bad ones first", () => {
    const r = v({ attendancePct: 70, avgLateMarksPerMonth: 9, kpiMonthsAtTargetPct: 10, openPip: true, activeWarnings: 2, priorAbsconding: true });
    expect(r.reasons.length).toBe(5);
    expect(r.reasons[0]!.tone).toBe("bad");
  });
});
