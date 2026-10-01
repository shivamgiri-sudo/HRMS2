import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: vi.fn(), buildEmployeeScopeCondition: vi.fn() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn() }));
vi.mock("../../../shared/reportingSpan.js", () => ({ spanClauseFor: vi.fn() }));

import { aucOf, gainCurve, scoreFeatures, suggestActions, tierOf, FACTOR_CAPS, FACTOR_GROUP_ORDER, type Features } from "../attrition-model.js";
import { buildAlerts, buildEmployeeRisk, buildInsights, buildOverview, buildRisk } from "../attrition-hub.builders.js";
import { buildModel, calibrate, type ExitRow, type Model, type ScoredPerson } from "../attrition-hub.service.js";

const calm: Features = { aonDays: 400, att60Pct: 97, attDeltaPts: 1, absentStreak: 0, absent7: 0, late30: 1, leaveCount60: 1, reg60: 0, kpiScore: 92, kpiDelta: 2, quality60: 88, peerCtcRatio: 1.05, monthsSinceIncrement: 5, tenureMonths: 13, warningSeverity: 0, warningCount: 0, activePip: false, hygieneMissing: 0, teamExitRate90: 0.02 };

describe("scoreFeatures", () => {
  it("a settled, performing, present employee scores LOW", () => {
    const s = scoreFeatures(calm);
    expect(s.tier).toBe("LOW");
    expect(s.score).toBeLessThan(10);
  });
  it("unknown signals score nothing - a non-dialler has no quality, and that is not a risk", () => {
    const s = scoreFeatures({ aonDays: 400 });
    expect(s.score).toBe(0);
    expect(s.reasons).toEqual([]);
  });
  it("a day-10 joiner who is absent for 3 days, late, underpaid and under a leaky manager is CRITICAL with explained reasons", () => {
    const s = scoreFeatures({ aonDays: 10, walkIn: true, att60Pct: 62, absentStreak: 3, late30: 12, peerCtcRatio: 0.8, ctc: 11000, teamExitRate90: 0.3 });
    expect(s.tier).toBe("CRITICAL");
    expect(s.reasons[0].points).toBeGreaterThanOrEqual(s.reasons[s.reasons.length - 1].points);
    expect(s.reasons.map((r) => r.label)).toEqual(expect.arrayContaining(["First 30 days", "Absent streak", "Low attendance", "Paid below peers", "Team is losing people"]));
    expect(s.reasons.every((r) => r.detail.length > 0)).toBe(true);
  });
  it("each group is capped and the total never exceeds 100", () => {
    const worst = scoreFeatures({ aonDays: 5, walkIn: true, att60Pct: 40, attDeltaPts: -30, absentStreak: 5, absent7: 5, late30: 20, leaveCount60: 9, reg60: 9, kpiScore: 30, kpiDelta: -30, quality60: 40, qualityVelocity: -30, ctc: 9000, peerCtcRatio: 0.5, monthsSinceIncrement: 30, tenureMonths: 30, warningSeverity: 3, warningCount: 4, activePip: true, hygieneMissing: 5, teamExitRate90: 0.6 });
    for (const g of FACTOR_GROUP_ORDER) expect(worst.factors[g]).toBeLessThanOrEqual(FACTOR_CAPS[g]);
    expect(worst.score).toBeLessThanOrEqual(100);
    expect(worst.tier).toBe("CRITICAL");
  });
  it("manager team losses are the strongest single signal (re-weighted from the 16-week lab on real data)", () => {
    expect(scoreFeatures({ aonDays: 400, teamExitRate90: 0.45 }).factors.team).toBe(30);
    expect(scoreFeatures({ aonDays: 400, teamExitRate90: 0.3 }).factors.team).toBe(22);
    expect(scoreFeatures({ aonDays: 400, teamExitRate90: 0.1 }).factors.team).toBe(7);
    expect(scoreFeatures({ aonDays: 400, peerCtcRatio: 0.8 }).factors.compensation).toBe(10);
  });
  it("late marks, leave churn and entry-level pay are not scored (they pointed the wrong way on real data)", () => {
    const s = scoreFeatures({ aonDays: 400, late30: 25, leaveCount60: 9, ctc: 9000 });
    expect(s.score).toBe(0);
    expect(s.reasons).toEqual([]);
  });
  it("tier cut-offs", () => {
    expect([tierOf(0), tierOf(24.9), tierOf(25), tierOf(40), tierOf(55)]).toEqual(["LOW", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });
  it("suggests an action for the reasons that fired", () => {
    const s = scoreFeatures({ aonDays: 20, absentStreak: 3 });
    const a = suggestActions(s.reasons, s.tier);
    expect(a.join(" ")).toMatch(/absconding/);
    expect(a.length).toBeLessThanOrEqual(4);
  });
});

describe("aucOf / gainCurve", () => {
  const perfect = [...Array(10)].map((_, i) => ({ score: i < 2 ? 90 : 10, leaver: i < 2 }));
  it("perfect ranking = 1, random = about 0.5, one-class = null", () => {
    expect(aucOf(perfect)).toBe(1);
    expect(aucOf([{ score: 5, leaver: true }, { score: 5, leaver: false }])).toBe(0.5);
    expect(aucOf([{ score: 1, leaver: false }])).toBeNull();
  });
  it("gain curve catches all leavers by the time their share of people is flagged", () => {
    const g = gainCurve(perfect, 10);
    expect(g[0]).toEqual({ popPct: 0, leaverPct: 0 });
    expect(g.find((p) => p.popPct === 20)?.leaverPct).toBe(100);
    expect(g[g.length - 1]).toEqual({ popPct: 100, leaverPct: 100 });
  });
});

describe("buildModel", () => {
  it("measures observed exit rate per tier and hides tiers with too few people", () => {
    const rows = [
      ...[...Array(40)].map((_, i) => ({ score: 60, leaver: i < 10, factors: { lifecycle: 0, attendance: 0, performance: 0, compensation: 0, conduct: 0, team: 0 } })),
      ...[...Array(10)].map(() => ({ score: 45, leaver: true, factors: { lifecycle: 0, attendance: 0, performance: 0, compensation: 0, conduct: 0, team: 0 } })),
    ];
    const m = buildModel([{ date: "2026-08-01", rows }]);
    expect(m.calibration.find((c) => c.tier === "CRITICAL")).toMatchObject({ n: 40, leavers: 10, observedRatePct: 25 });
    // 10 people, all leavers, is too thin to quote on its own: HIGH borrows from the tiers below it (none have data)
    expect(m.calibration.find((c) => c.tier === "HIGH")?.observedRatePct).toBeNull();
    expect(m.leavers).toBe(20);
  });
  it("pools a thin tier with the next one down and never lets a riskier tier read safer", () => {
    const mk = (score: number, n: number, l: number) => [...Array(n)].map((_, i) => ({ score, leaver: i < l }));
    // CRITICAL: 16 people / 3 leavers (thin) pools with HIGH: 218 / 19
    const pooled = calibrate([...mk(60, 16, 3), ...mk(45, 218, 19), ...mk(30, 637, 31), ...mk(10, 926, 17)]);
    const rate = (t: string) => pooled.find((c) => c.tier === t)!.observedRatePct!;
    expect(rate("CRITICAL")).toBeCloseTo(9.4, 1);
    expect(rate("CRITICAL")).toBe(rate("HIGH"));
    expect(rate("MEDIUM")).toBeCloseTo(4.9, 1);
    // an inversion (HIGH safer than MEDIUM) is flattened
    const inv = calibrate([...mk(60, 50, 1), ...mk(45, 100, 2), ...mk(30, 200, 20), ...mk(10, 500, 5)]);
    const r = (t: string) => inv.find((c) => c.tier === t)!.observedRatePct!;
    expect(r("CRITICAL")).toBeGreaterThanOrEqual(r("HIGH"));
    expect(r("HIGH")).toBeGreaterThanOrEqual(r("MEDIUM"));
    expect(r("MEDIUM")).toBeGreaterThanOrEqual(r("LOW"));
  });
});

/* ── builders ── */
const ASOF = "2026-10-01";
let n = 0;
function person(over: Partial<ScoredPerson> & { f?: Features } = {}): ScoredPerson {
  const features = over.f ?? { ...calm };
  const sc = scoreFeatures(features);
  return { id: `e${++n}`, code: `MAS${n}`, name: `Person ${n}`, designation: "Agent", process: "Sales", branch: "Noida", manager: "Mgr A",
    designationId: "d1", processId: "p1", branchId: "b1", managerId: "m1", source: "Referral", joinDate: "2025-01-01", aonDays: features.aonDays, exitDate: null,
    features, score: sc.score, tier: sc.tier, factors: sc.factors, reasons: sc.reasons, inNotice: false, ...over };
}
const exit = (daysAgo: number, tenureDays: number, over: Partial<ExitRow> = {}): ExitRow => {
  const d = new Date(`${ASOF}T00:00:00`); d.setDate(d.getDate() - daysAgo);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { id: `x${++n}`, joinDate: "2025-01-01", exitDate: ymd, tenureDays, source: "Walk-in", branchId: "b1", branch: "Noida", processId: "p1", process: "Sales", managerId: "m1", manager: "Mgr A", designationId: "d1", designation: "Agent", reason: null, exitType: "voluntary", ...over };
};
const model: Model = { computedAt: "", cohortDates: [], population: 1000, leavers: 40, baseRatePct: 4, auc: 0.7, gain: [], limits: [],
  calibration: [{ tier: "CRITICAL", n: 60, leavers: 18, observedRatePct: 30 }, { tier: "HIGH", n: 100, leavers: 15, observedRatePct: 15 }, { tier: "MEDIUM", n: 200, leavers: 10, observedRatePct: 5 }, { tier: "LOW", n: 640, leavers: 5, observedRatePct: 0.8 }], drivers: [] };

describe("builders", () => {
  const risky = person({ f: { aonDays: 12, absentStreak: 4, att60Pct: 60, late30: 12, peerCtcRatio: 0.8, teamExitRate90: 0.3 }, managerId: "m2", manager: "Mgr B" });
  const people = [risky, person(), person(), person({ inNotice: true, f: { aonDays: 5, absentStreak: 5, att60Pct: 50 } })];
  const exits = [exit(5, 20), exit(9, 40), exit(12, 70), exit(40, 500), exit(75, 30), exit(200, 800)];
  const events = [...people.map(() => ({ join: "2025-01-01", exit: null, source: "Referral" })), ...exits.map((e) => ({ join: e.joinDate, exit: e.exitDate, source: e.source }))];

  it("overview: windows, early share, expected exits (calibrated) and tier counts exclude people in notice", () => {
    const o = buildOverview({ asOf: ASOF, people, exits, events, model, degraded: [] });
    expect(o.headcount).toBe(4);
    expect(o.exits30).toBe(3);
    expect(o.exits90).toBe(5);
    expect(o.earlyExitSharePct).toBe(80);
    expect(o.inNotice).toBe(1);
    expect(o.atRisk.CRITICAL + o.atRisk.HIGH + o.atRisk.MEDIUM + o.atRisk.LOW).toBe(3);
    expect(o.expectedExits30).toBeGreaterThanOrEqual(0.3);
    expect(o.trend).toHaveLength(12);
    expect(o.trend[11].ratePct).toBeNull();
    expect(o.trend[10].ratePct).not.toBeNull();
    expect(o.trend.reduce((s, t) => s + t.exits, 0)).toBe(exits.length);
    expect(o.degraded).toEqual([]);
    expect(buildOverview({ asOf: ASOF, people, exits, events, model: null, degraded: [] }).degraded).toContain("model-calibration");
  });

  it("risk: filters, sort, tier counts ignore the tier filter, in-notice people never listed", () => {
    const all = buildRisk(people, {}, model);
    expect(all.total).toBe(3);
    expect(all.rows[0].employeeId).toBe(risky.id);
    expect(all.rows[0].probability30).toBeCloseTo(0.3);
    expect(all.rows.some((r) => r.employeeId === people[3].id)).toBe(false);
    const crit = buildRisk(people, { tier: "CRITICAL" }, model);
    expect(crit.total).toBe(1);
    expect(crit.tierCounts.LOW).toBe(2);
    expect(buildRisk(people, { absentOnly: true }, model).total).toBe(1);
    expect(buildRisk(people, { newJoinerOnly: true }, model).total).toBe(1);
    expect(buildRisk(people, { q: "person 9999" }, model).total).toBe(0);
    expect(all.drivers.reduce((s, d) => s + d.sharePct, 0)).toBeGreaterThan(99);
  });

  it("employee detail lists signals and flags the ones that fired", () => {
    const d = buildEmployeeRisk(risky, model);
    expect(d.signals.find((s) => s.label === "Absent streak")).toMatchObject({ flag: true });
    expect(d.signals.find((s) => s.label === "Call quality (60 days)")).toMatchObject({ value: "Not audited", flag: false });
  });

  it("insights: hotspot vs company, tenure bins, reasons coverage", () => {
    const i = buildInsights({ asOf: ASOF, people, exits, events });
    expect(i.tenureAtExit.find((b) => b.bucket === "0-30")?.exits).toBe(2);
    expect(i.reasons[0].reason).toBe("Not recorded");
    expect(i.reasonCoveragePct).toBe(0);
    expect(i.exitType.voluntary).toBe(6);
  });

  it("alerts: critical risk, absent streak, and info for people in notice; sorted critical first", () => {
    const a = buildAlerts({ asOf: ASOF, people, exits, events, model, degraded: ["kpi"] });
    const ids = a.alerts.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["risk-critical", "absence-streak", "in-notice", "data-degraded"]));
    expect(a.alerts[0].severity).toBe("critical");
    expect(a.counts.critical).toBeGreaterThanOrEqual(2);
    expect(a.alerts.find((x) => x.id === "absence-streak")?.link).toEqual({ absentOnly: true });
    const abs = a.alerts.find((x) => x.id === "absence-streak")!;
    expect(abs.metric).toEqual({ label: "Share of headcount", value: "33.3%" });
    expect(abs.detail).toMatch(/first 30 days/);
    expect(abs.detail).not.toMatch(/check that clock-ins/);
  });

  it("alerts: a very large absent share is flagged as possibly an attendance-feed gap", () => {
    const crowd = [...Array(40)].map(() => person({ f: { aonDays: 20, absentStreak: 4, att60Pct: 55 } }));
    const a = buildAlerts({ asOf: ASOF, people: crowd, exits: [], events: [], model, degraded: [] });
    expect(a.alerts.find((x) => x.id === "absence-streak")!.detail).toMatch(/check that clock-ins are being recorded/);
  });

  it("alerts: a hotspot needs 2x the company rate AND 3+ exits", () => {
    const hotPeople = [...[...Array(6)].map(() => person({ branchId: "bHot", branch: "Hot" })), ...[...Array(60)].map(() => person({ branchId: "bCalm", branch: "Calm" }))];
    const hotExits = [...Array(6)].map((_, i) => exit(10 + i, 400, { branchId: "bHot", branch: "Hot" }));
    const a = buildAlerts({ asOf: ASOF, people: hotPeople, exits: hotExits, events: [], model, degraded: [] });
    expect(a.alerts.some((x) => x.id.startsWith("hotspot-branch-bHot"))).toBe(true);
    expect(a.alerts.some((x) => x.id.startsWith("hotspot-branch-bCalm"))).toBe(false);
  });
});
