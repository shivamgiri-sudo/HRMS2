import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: vi.fn(), buildEmployeeScopeCondition: vi.fn() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn() }));
vi.mock("../../../shared/reportingSpan.js", () => ({ spanClauseFor: vi.fn() }));

import { scoreFeatures, type Features } from "../attrition-model.js";
import { buildAlerts, buildInsights } from "../attrition-hub.builders.js";
import { buildBatches, buildDrill, buildOutlook, buildPulse, buildScorecard } from "../attrition-hub.drill.js";
import { validateFollowup } from "../attrition-hub.followups.js";
import type { EmpEvent, Model, ScoredPerson } from "../attrition-hub.service.js";

const ASOF = "2026-10-07"; // a Wednesday
const ymd = (s: string, add: number) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + add); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
let n = 0;
const ev = (over: Partial<EmpEvent> & { daysAgo?: number; stayed?: number } = {}): EmpEvent => {
  const join = over.join ?? ymd(ASOF, -(over.daysAgo ?? 400));
  const exit = over.exit !== undefined ? over.exit : over.stayed != null ? ymd(join, over.stayed) : null;
  const { daysAgo: _d, stayed: _s, ...rest } = over;
  return { id: `e${++n}`, code: `MAS${n}`, name: `Person ${n}`, join, exit, source: "Referral", branchId: "b1", branch: "Noida", processId: "p1", process: "Sales", managerId: "m1", manager: "Mgr A", designationId: "d1", designation: "Agent", reason: null, exitType: "voluntary", ...rest };
};
const person = (e: EmpEvent, f: Features, over: Partial<ScoredPerson> = {}): ScoredPerson => {
  const sc = scoreFeatures(f);
  return { id: e.id, code: e.code, name: e.name, designation: e.designation, process: e.process, branch: e.branch, manager: e.manager, designationId: e.designationId, processId: e.processId, branchId: e.branchId, managerId: e.managerId,
    source: e.source, joinDate: e.join, aonDays: f.aonDays, exitDate: null, features: f, score: sc.score, tier: sc.tier, factors: sc.factors, reasons: sc.reasons, inNotice: false, ...over };
};
const model: Model = { computedAt: "", cohortDates: [], population: 1000, leavers: 100, baseRatePct: 10, auc: 0.7, gain: [], limits: [], history: [],
  calibration: [{ tier: "CRITICAL", n: 60, leavers: 24, observedRatePct: 40 }, { tier: "HIGH", n: 100, leavers: 25, observedRatePct: 25 }, { tier: "MEDIUM", n: 200, leavers: 20, observedRatePct: 10 }, { tier: "LOW", n: 640, leavers: 30, observedRatePct: 5 }], drivers: [] };

describe("buildDrill", () => {
  const a = ev({ daysAgo: 20 }), b = ev({ daysAgo: 300, branchId: "b2", branch: "Delhi" }), c = ev({ daysAgo: 500 });
  const left1 = ev({ daysAgo: 100, stayed: 25, reason: "better_opportunity" });
  const left2 = ev({ daysAgo: 200, stayed: 150, reason: null, exitType: "involuntary", branchId: "b2", branch: "Delhi" });
  const left3 = ev({ daysAgo: 90, stayed: 10, reason: null });
  const people = [
    person(a, { aonDays: 20, absentStreak: 4, att60Pct: 55 }),
    person(b, { aonDays: 300, peerCtcRatio: 0.8 }),
    person(c, { aonDays: 500 }, { inNotice: true }),
  ];
  const events = [a, b, c, left1, left2, left3];
  const base = { asOf: ASOF, people, events, model, followups: new Map<string, { kind: string; outcome: string; at: string }>() };

  it("active: filters by tier / group / absent / branch, leaves people in notice out unless asked, and explains the slice", () => {
    const all = buildDrill({ ...base, filters: { population: "active" } });
    expect(all.total).toBe(2);
    expect(all.rows[0].employeeId).toBe(a.id);
    expect(all.rows[0]).toMatchObject({ status: "active", absentStreak: 4 });
    expect(all.summary.map((s) => s.label)).toEqual(["People", "Average risk score", "Expected exits, next 30d", "High + Critical"]);
    expect(all.mix.reduce((s, m) => s + m.value, 0)).toBe(2);
    expect(buildDrill({ ...base, filters: { population: "active", absentOnly: true } }).total).toBe(1);
    expect(buildDrill({ ...base, filters: { population: "active", minAbsentStreak: 4 } }).total).toBe(1);
    expect(buildDrill({ ...base, filters: { population: "active", minAbsentStreak: 5 } }).total).toBe(0);
    expect(buildDrill({ ...base, filters: { population: "active", group: "compensation" } }).rows.map((r) => r.employeeId)).toEqual([b.id]);
    expect(buildDrill({ ...base, filters: { population: "active", branchId: "b2" } }).total).toBe(1);
    expect(buildDrill({ ...base, filters: { population: "active", notice: true } }).rows[0]).toMatchObject({ employeeId: c.id, status: "notice" });
  });

  it("active: follow-up filter and last follow-up on the row", () => {
    const followups = new Map([[a.id, { kind: "absent_outreach", outcome: "not_reachable", at: "2026-10-06T10:00:00Z" }]]);
    expect(buildDrill({ ...base, followups, filters: { population: "active", followup: "none" } }).rows.map((r) => r.employeeId)).toEqual([b.id]);
    const any = buildDrill({ ...base, followups, filters: { population: "active", followup: "any" } });
    expect(any.rows[0].lastFollowup).toMatchObject({ outcome: "not_reachable" });
  });

  it("exits: month, tenure bin, reason, no-reason and type narrow to the right leavers", () => {
    const x = buildDrill({ ...base, filters: { population: "exits" } });
    expect(x.total).toBe(3);
    expect(buildDrill({ ...base, filters: { population: "exits", tenureBin: "0-30" } }).total).toBe(2);
    expect(buildDrill({ ...base, filters: { population: "exits", aonBucket: "90+" } }).total).toBe(1);
    expect(buildDrill({ ...base, filters: { population: "exits", reason: "better opportunity" } }).total).toBe(1);
    expect(buildDrill({ ...base, filters: { population: "exits", reason: "Not recorded" } }).total).toBe(2);
    expect(buildDrill({ ...base, filters: { population: "exits", noReason: true, branchId: "b2" } }).total).toBe(1);
    expect(buildDrill({ ...base, filters: { population: "exits", exitType: "involuntary" } }).total).toBe(1);
    expect(buildDrill({ ...base, filters: { population: "exits", month: left1.exit!.slice(0, 7) } }).total).toBeGreaterThanOrEqual(1);
    expect(buildDrill({ ...base, filters: { population: "exits", windowDays: 30 } }).total).toBe(0);
    expect(x.rows[0].status).toBe("left");
    expect(x.mix.find((m) => m.label === "0-30")?.value).toBe(2);
  });

  it("joiners: a batch week returns members who stayed and who left, with 90-day survival", () => {
    const wk = "2026-09-14";
    const m1 = ev({ join: "2026-09-15" }), m2 = ev({ join: "2026-09-16", stayed: 5 }), other = ev({ join: "2026-09-30" });
    const d = buildDrill({ ...base, events: [m1, m2, other], filters: { population: "joiners", joinWeek: wk } });
    expect(d.total).toBe(2);
    expect(d.rows.find((r) => r.employeeId === m2.id)?.status).toBe("left");
    expect(d.summary.find((s) => s.label === "Joined")?.value).toBe("2");
    expect(d.summary.find((s) => s.label === "90-day survival")?.value).toBe("not old enough");
  });

  it("paging and search", () => {
    const d = buildDrill({ ...base, filters: { population: "exits", limit: 1, offset: 1 } });
    expect(d.rows).toHaveLength(1);
    expect(d.total).toBe(3);
    expect(buildDrill({ ...base, filters: { population: "exits", q: left1.code.toLowerCase() } }).total).toBe(1);
  });
});

describe("buildBatches", () => {
  it("survival and show-up are only filled once the whole batch is old enough, and per-week", () => {
    const wk = "2026-08-31"; // Monday, 37+ days before ASOF
    const mem = [ev({ join: "2026-09-01" }), ev({ join: "2026-09-01", stayed: 2 }), ev({ join: "2026-09-02", stayed: 20 }), ev({ join: "2026-09-02" })];
    const firstPresent = new Map<string, number | null>([[mem[0].id, 0], [mem[1].id, 3], [mem[2].id, 0], [mem[3].id, null]]);
    const seen = new Set(mem.map((m) => m.id));
    const { batches } = buildBatches({ asOf: ASOF, events: mem, firstPresent, seen, absent: new Set([mem[3].id]) });
    const b = batches.find((x) => x.weekStart === wk)!;
    expect(b.joined).toBe(4);
    expect(b.activeNow).toBe(2);
    expect(b.absentNow).toBe(1);
    expect(b.survival.d1).toBe(100);
    expect(b.survival.d3).toBe(75);       // one left after 2 days
    expect(b.survival.d30).toBe(50);      // and one after 20
    expect(b.survival.d90).toBeNull();    // not 90 days old yet
    expect(b.showUp.d1).toBe(50);         // 2 of 4 present on day 1 (offset 0)
    expect(b.showUp.d7).toBe(75);         // plus the one who came on day 4
    expect(b.sources[0]).toMatchObject({ source: "Referral", joined: 4, activeNow: 2 });
  });
  it("a batch that is too new reports nothing rather than a misleading 100%", () => {
    const m = [ev({ join: "2026-10-06" })];
    const b = buildBatches({ asOf: ASOF, events: m, firstPresent: new Map(), seen: new Set() }).batches[0];
    expect(b.survival.d7).toBeNull();
    expect(b.showUp.d3).toBeNull();
  });
});

describe("buildScorecard", () => {
  it("survival per group among those old enough, company line, small groups dropped", () => {
    const good = [...Array(6)].map(() => ev({ daysAgo: 200, source: "Referral" }));
    const bad = [...Array(6)].map((_, i) => ev({ daysAgo: 200, source: "Walk-in", stayed: i < 4 ? 20 : undefined }));
    const tiny = [ev({ daysAgo: 200, source: "Portal" })];
    const s = buildScorecard({ asOf: ASOF, events: [...good, ...bad, ...tiny], by: "source" });
    expect(s.rows.map((r) => r.label)).toEqual(["Walk-in", "Referral"]);
    expect(s.rows[0]).toMatchObject({ joined: 6, n30: 6, s30: 33.3, s90: 33.3 });
    expect(s.rows[1].s90).toBe(100);
    expect(s.company.s90).toBe(69.2);
  });
});

describe("buildOutlook", () => {
  it("projects headcount = now - expected exits - notice exits + planned joiners, worst gap first", () => {
    const e1 = ev(), e2 = ev({ branchId: "b2", branch: "Delhi" });
    const low = (e: EmpEvent) => person(e, { aonDays: 400 });
    const people = [...[...Array(5)].map(() => low(ev())), ...[...Array(5)].map(() => low(ev({ branchId: "b2", branch: "Delhi" }))), person(e1, { aonDays: 400 }), person(e2, { aonDays: 400 })];
    const o = buildOutlook({ people, model, data: { notice: [{ employeeId: "x", branchId: "b1", branch: "Noida", processId: "p1", process: "Sales", lwd: "2026-10-20" }], planned: [{ branchId: "b2", branch: "Delhi", processId: "p1", process: "Sales" }] } });
    expect(o.headcount).toBe(12);
    expect(o.noticeExits).toBe(1);
    expect(o.plannedJoiners).toBe(1);
    expect(o.expectedExits).toBeCloseTo(0.6, 1);
    expect(o.projected).toBe(Math.round(12 - 0.6 - 1 + 1));
    expect(o.byBranch[0].label).toBe("Noida");
    expect(o.byBranch[0].gapPct!).toBeLessThan(o.byBranch[1].gapPct!);
  });
});

describe("buildInsights additions", () => {
  it("excess exits: a group that loses more than its tenure mix explains shows positive excess, company-typical shows ~0", () => {
    // 100 veterans in b1 (few leave) + 100 veterans in b2 where a lot leave
    const b1 = [...Array(100)].map((_, i) => ev({ daysAgo: 600, branchId: "b1", branch: "Noida", stayed: i < 5 ? 560 : undefined }));
    const b2 = [...Array(100)].map((_, i) => ev({ daysAgo: 600, branchId: "b2", branch: "Delhi", stayed: i < 30 ? 560 : undefined }));
    const events = [...b1, ...b2];
    const people = events.filter((e) => !e.exit).map((e) => person(e, { aonDays: 600 }));
    const exits = events.filter((e) => e.exit).map((e) => ({ id: e.id, joinDate: e.join, exitDate: e.exit!, tenureDays: 560, source: e.source, branchId: e.branchId, branch: e.branch, processId: e.processId, process: e.process, managerId: e.managerId, manager: e.manager, designationId: e.designationId, designation: e.designation, reason: e.reason, exitType: e.exitType }));
    const ins = buildInsights({ asOf: ASOF, people, exits, events });
    const h = (l: string) => ins.hotspots.branch.find((x) => x.label === l)!;
    expect(h("Delhi").excess90!).toBeGreaterThan(0);
    expect(h("Noida").excess90!).toBeLessThan(0);
    expect(h("Delhi").expected90).not.toBeNull();
  });
  it("a manager whose team is gone is not rated (no headcount, no meaningful rate)", () => {
    const gone = [...Array(8)].map(() => ev({ daysAgo: 300, stayed: 100, managerId: "mGone", manager: "Gone" }));
    const ok = [...Array(10)].map(() => ev({ daysAgo: 300, managerId: "mOk", manager: "Ok" }));
    const events = [...gone, ...ok];
    const people = ok.map((e) => person(e, { aonDays: 300 }));
    const exits = gone.map((e) => ({ id: e.id, joinDate: e.join, exitDate: ymd(ASOF, -20), tenureDays: 100, source: e.source, branchId: e.branchId, branch: e.branch, processId: e.processId, process: e.process, managerId: e.managerId, manager: e.manager, designationId: e.designationId, designation: e.designation, reason: null, exitType: null }));
    const ins = buildInsights({ asOf: ASOF, people, exits, events });
    expect(ins.hotspots.manager.some((h) => h.label === "Gone")).toBe(false);
    expect(ins.hotspots.manager.some((h) => h.label === "Ok")).toBe(true);
  });
  it("reason capture by branch, worst first, small branches skipped", () => {
    const exits = [...[...Array(6)].map((_, i) => ({ branchId: "b1", branch: "Noida", reason: i < 5 ? "x" : null })), ...[...Array(6)].map(() => ({ branchId: "b2", branch: "Delhi", reason: null })), ...[...Array(2)].map(() => ({ branchId: "b3", branch: "Tiny", reason: null }))]
      .map((p, i) => ({ id: `r${i}`, joinDate: ymd(ASOF, -200), exitDate: ymd(ASOF, -10), tenureDays: 190, source: null, processId: null, process: null, managerId: null, manager: null, designationId: null, designation: null, exitType: null, ...p }));
    const ins = buildInsights({ asOf: ASOF, people: [], exits, events: [] });
    expect(ins.reasonByBranch.map((r) => [r.label, r.pct])).toEqual([["Delhi", 0], ["Noida", 83.3]]);
  });
});

describe("legacy reasons in the insights and alerts", () => {
  const mk = (reason: string | null, source: "exit_record" | "legacy" | null) => ev({ daysAgo: 300, stayed: 250, reason, ...(source ? { reasonSource: source } : {}) } as Partial<EmpEvent>);
  it("counts where each reason came from and raises one absconding alert when it dominates", () => {
    const events = [...[...Array(30)].map(() => mk("absconding", "legacy")), ...[...Array(10)].map(() => mk("better_opportunity", "exit_record")), ...[...Array(5)].map(() => mk(null, null))];
    const exits = events.map((e) => ({ id: e.id, joinDate: e.join, exitDate: ymd(ASOF, -30), tenureDays: 250, source: e.source, branchId: e.branchId, branch: e.branch, processId: e.processId, process: e.process, managerId: e.managerId, manager: e.manager, designationId: e.designationId, designation: e.designation, reason: e.reason, exitType: e.exitType, reasonSource: (e as { reasonSource?: "exit_record" | "legacy" | null }).reasonSource ?? null }));
    const ins = buildInsights({ asOf: ASOF, people: [], exits, events });
    expect(ins.reasonSources).toEqual({ exitRecord: 10, legacy: 30, none: 5 });
    expect(ins.reasonCoveragePct).toBe(88.9);
    expect(ins.reasons[0]).toMatchObject({ reason: "absconding", exits: 30 });
    const al = buildAlerts({ asOf: ASOF, people: [], exits, events, model, degraded: [] });
    const a = al.alerts.find((x) => x.id === "absconding-share")!;
    expect(a.severity).toBe("critical");
    expect(a.title).toMatch(/66\.7%/);
  });
  it("no absconding alert when exits are few or the share is small", () => {
    const events = [...[...Array(30)].map(() => mk("better_opportunity", "exit_record")), ...[...Array(4)].map(() => mk("absconding", "legacy"))];
    const exits = events.map((e) => ({ id: e.id, joinDate: e.join, exitDate: ymd(ASOF, -30), tenureDays: 250, source: e.source, branchId: e.branchId, branch: e.branch, processId: e.processId, process: e.process, managerId: e.managerId, manager: e.manager, designationId: e.designationId, designation: e.designation, reason: e.reason, exitType: e.exitType }));
    expect(buildAlerts({ asOf: ASOF, people: [], exits, events, model, degraded: [] }).alerts.some((x) => x.id === "absconding-share")).toBe(false);
  });
});

describe("buildPulse", () => {
  it("is the crisp card: tier counts, absent streak, new-joiner risk, six-month sparkline, top alerts without info noise", () => {
    const e1 = ev({ daysAgo: 20 }), e2 = ev({ daysAgo: 400 });
    const people = [person(e1, { aonDays: 20, absentStreak: 5, att60Pct: 50, teamExitRate90: 0.45 }), person(e2, { aonDays: 400 })];
    const trend = [...Array(12)].map((_, i) => ({ month: `2026-${String(i % 12 + 1).padStart(2, "0")}`, exits: i }));
    const pulse = buildPulse({
      overview: { asOf: ASOF, headcount: 2, exits30: 9, exitsPrev30: 12, earlyExitSharePct: 40, expectedExits30: 0.5, atRisk: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 1 }, trend, degraded: [] },
      alerts: { alerts: [{ severity: "info" }, { severity: "warning" }, { severity: "critical" }] },
      people, scope: "branch",
    });
    expect(pulse).toMatchObject({ scope: "branch", critical: 1, high: 0, absentStreak: 1, newJoinerRisk: 1, exits30: 9 });
    expect(pulse.monthlyExits).toHaveLength(6);
    expect(pulse.topAlerts.map((a) => a.severity)).toEqual(["critical", "warning"]);
  });
});

describe("validateFollowup", () => {
  it("accepts known kinds/outcomes, trims and caps the note, rejects the rest", () => {
    expect(validateFollowup({ kind: "absent_outreach", outcome: "not_reachable", note: "  rang twice  " })).toEqual({ ok: true, kind: "absent_outreach", outcome: "not_reachable", note: "rang twice" });
    const long = validateFollowup({ kind: "other", outcome: "pending", note: "x".repeat(900) });
    expect(long.ok && long.note!.length).toBe(500);
    expect(validateFollowup({ kind: "nope", outcome: "pending" }).ok).toBe(false);
    expect(validateFollowup({ kind: "other", outcome: "nope" }).ok).toBe(false);
  });
});
