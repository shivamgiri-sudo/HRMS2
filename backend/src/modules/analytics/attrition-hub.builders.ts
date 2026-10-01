/**
 * Attrition hub - response builders. Pure functions over already-loaded data (no I/O), so every
 * number the page shows can be unit-tested with plain fixtures.
 */
import { FACTOR_CAPS, FACTOR_GROUP_ORDER, suggestActions, type FactorGroup, type Tier } from "./attrition-model.js";
import { addDays } from "./attrition-hub.data.js";
import { TIERS, bucketOf, probabilityFor, type EmpEvent, type ExitRow, type Model, type ScoredPerson } from "./attrition-hub.service.js";

export type Events = { join: string; exit: string | null; source: string | null }[];
const r1 = (v: number) => Math.round(v * 10) / 10;
const inWindow = (d: string, afterExcl: string, toIncl: string) => d > afterExcl && d <= toIncl;
const live = (people: ScoredPerson[]) => people.filter((p) => !p.inNotice);
const headcountAt = (events: Events, date: string) => events.filter((e) => e.join <= date && (!e.exit || e.exit > date)).length;

function probOf(model: Model | null, tier: Tier): number | null {
  return model ? probabilityFor(model, tier) : null;
}
/** Tiers too thin to calibrate fall back to the overall past rate, so totals stay honest. */
function expectedProb(model: Model | null, tier: Tier): number {
  return probOf(model, tier) ?? (model ? model.baseRatePct / 100 : 0);
}

/* ── overview ── */
export function buildOverview(a: { asOf: string; people: ScoredPerson[]; exits: ExitRow[]; events: Events; model: Model | null; degraded: string[] }) {
  const { asOf, people, exits, events, model } = a;
  const e30 = exits.filter((e) => inWindow(e.exitDate, addDays(asOf, -30), asOf));
  const ePrev = exits.filter((e) => inWindow(e.exitDate, addDays(asOf, -60), addDays(asOf, -30)));
  const e90 = exits.filter((e) => inWindow(e.exitDate, addDays(asOf, -90), asOf));
  const hcNow = people.length;
  const hc90 = headcountAt(events, addDays(asOf, -90));
  const avgHc = (hcNow + hc90) / 2;
  const atRisk = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<Tier, number>;
  let expected = 0;
  for (const p of live(people)) { atRisk[p.tier]++; expected += expectedProb(model, p.tier); }

  const trend: { month: string; exits: number; headcount: number; ratePct: number | null; byBucket: Record<string, number> }[] = [];
  const first = new Date(`${asOf}T00:00:00`);
  for (let i = 11; i >= 0; i--) {
    const start = new Date(first.getFullYear(), first.getMonth() - i, 1);
    const next = new Date(first.getFullYear(), first.getMonth() - i + 1, 1);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const s = f(start), n = f(next);
    const inM = exits.filter((e) => e.exitDate >= s && e.exitDate < n);
    const byBucket = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<string, number>;
    for (const e of inM) byBucket[bucketOf(e.tenureDays)]++;
    const hc = headcountAt(events, addDays(s, -1));
    // the month in progress has no complete rate yet; a partial count would draw a false drop
    trend.push({ month: s.slice(0, 7), exits: inM.length, headcount: hc, ratePct: hc > 0 && i > 0 ? r1((inM.length / hc) * 100) : null, byBucket });
  }
  return {
    asOf, headcount: hcNow, exits30: e30.length, exitsPrev30: ePrev.length, exits90: e90.length,
    annualisedRatePct: avgHc > 0 ? r1((e90.length * 4 / avgHc) * 100) : null,
    earlyExitSharePct: e90.length ? r1((e90.filter((e) => e.tenureDays <= 90).length / e90.length) * 100) : null,
    expectedExits30: r1(expected), atRisk, inNotice: people.filter((p) => p.inNotice).length, trend,
    degraded: [...a.degraded, ...(model ? [] : ["model-calibration"])],
  };
}

/* ── insights ── */
export const TENURE_BINS: [string, (d: number) => boolean][] = [
  ["0-30", (d) => d <= 30], ["31-60", (d) => d > 30 && d <= 60], ["61-90", (d) => d > 60 && d <= 90],
  ["91-180", (d) => d > 90 && d <= 180], ["181-365", (d) => d > 180 && d <= 365], ["1-2y", (d) => d > 365 && d <= 730], ["2y+", (d) => d > 730],
];

export function buildInsights(a: { asOf: string; people: ScoredPerson[]; exits: ExitRow[]; events: Events }) {
  const { asOf, people, exits, events } = a;
  const e90 = exits.filter((e) => inWindow(e.exitDate, addDays(asOf, -90), asOf));
  const e12 = exits.filter((e) => inWindow(e.exitDate, addDays(asOf, -365), asOf));
  const rate = (hc: number, ex: number) => (hc + ex / 2 > 0 ? (ex * 4) / (hc + ex / 2) * 100 : null);
  const company = rate(people.length, e90.length);

  // What each group's 90-day exits "should" be given how long its people had been here, at the company's own
  // rates per tenure band. Only possible when the events carry who-belongs-where (the live loader does).
  const rich = events.length > 0 && "branchId" in events[0] ? (events as unknown as EmpEvent[]) : null;
  const S = addDays(asOf, -90);
  const bandOf = (daysIn: number) => (daysIn <= 30 ? 0 : daysIn <= 60 ? 1 : daysIn <= 90 ? 2 : daysIn <= 180 ? 3 : daysIn <= 365 ? 4 : 5);
  const dayDiff = (x: string, y: string) => Math.round((new Date(`${y}T00:00:00`).getTime() - new Date(`${x}T00:00:00`).getTime()) / 86_400_000);
  const startCohort = rich ? rich.filter((e) => e.join <= S && (!e.exit || e.exit > S)) : [];
  const bandRate = (() => {
    const n = [0, 0, 0, 0, 0, 0], l = [0, 0, 0, 0, 0, 0];
    for (const e of startCohort) { const b = bandOf(dayDiff(e.join, S)); n[b]++; if (e.exit && e.exit <= asOf) l[b]++; }
    return n.map((c, i) => (c >= 20 ? l[i] / c : null));
  })();

  type G = { id: string | null; label: string; hc: number; ex: number; high: number; exp: number };
  const dim = (idOf: (x: { branchId?: string | null; processId?: string | null; managerId?: string | null; designationId?: string | null }) => string | null,
               labelOf: (x: { branch?: string | null; process?: string | null; manager?: string | null; designation?: string | null }) => string | null) => {
    const m = new Map<string, G>();
    const get = (id: string | null, label: string | null) => {
      const k = id ?? "none";
      if (!m.has(k)) m.set(k, { id, label: label ?? "Unassigned", hc: 0, ex: 0, high: 0, exp: 0 });
      return m.get(k)!;
    };
    for (const p of people) { const g = get(idOf(p), labelOf(p)); g.hc++; if (!p.inNotice && (p.tier === "HIGH" || p.tier === "CRITICAL")) g.high++; }
    for (const e of e90) get(idOf(e), labelOf(e)).ex++;
    if (rich) for (const e of startCohort) {
      const r = bandRate[bandOf(dayDiff(e.join, S))];
      if (r != null) get(idOf(e), labelOf(e)).exp += r;
    }
    return [...m.values()]
      .filter((g) => g.hc >= 5 || (g.ex >= 3 && g.hc >= 3)) // a group with nobody left has no meaningful rate
      .map((g) => { const r = rate(g.hc, g.ex); return { id: g.id, label: g.label, headcount: g.hc, exits90: g.ex, ratePct: r == null ? null : r1(r), vsCompany: r != null && company ? r1(r / company) : null, highRisk: g.high,
        expected90: rich ? r1(g.exp) : null, excess90: rich ? r1(g.ex - g.exp) : null }; })
      .sort((x, y) => (y.ratePct ?? -1) - (x.ratePct ?? -1))
      .slice(0, 12);
  };

  const tenureAtExit = TENURE_BINS.map(([bucket, f]) => ({ bucket, exits: e12.filter((e) => f(e.tenureDays)).length }));
  const reasonCount = new Map<string, number>();
  for (const e of e12) { const k = e.reason ? e.reason.replace(/_/g, " ") : "Not recorded"; reasonCount.set(k, (reasonCount.get(k) ?? 0) + 1); }
  const recorded = e12.filter((e) => e.reason).length;
  const t = (x: string | null) => String(x ?? "").toLowerCase();

  const joinFrom = addDays(asOf, -365), matured = addDays(asOf, -90);
  const src = new Map<string, { exits: number; joiners: number; matured: number; early: number }>();
  const s = (k: string | null) => { const key = k?.trim() || "Unknown"; if (!src.has(key)) src.set(key, { exits: 0, joiners: 0, matured: 0, early: 0 }); return src.get(key)!; };
  for (const e of e12) s(e.source).exits++;
  for (const ev of events) {
    if (ev.join > joinFrom && ev.join <= asOf) s(ev.source).joiners++;
    if (ev.join > joinFrom && ev.join <= matured) {
      const g = s(ev.source); g.matured++;
      if (ev.exit && (new Date(`${ev.exit}T00:00:00`).getTime() - new Date(`${ev.join}T00:00:00`).getTime()) / 86_400_000 <= 90) g.early++;
    }
  }
  return {
    hotspots: {
      branch: dim((x) => x.branchId ?? null, (x) => x.branch ?? null),
      process: dim((x) => x.processId ?? null, (x) => x.process ?? null),
      manager: dim((x) => x.managerId ?? null, (x) => x.manager ?? null),
      designation: dim((x) => x.designationId ?? null, (x) => x.designation ?? null),
    },
    tenureAtExit,
    reasons: [...reasonCount.entries()].map(([reason, n]) => ({ reason, exits: n })).sort((x, y) => y.exits - x.exits).slice(0, 12),
    reasonCoveragePct: e12.length ? r1((recorded / e12.length) * 100) : null,
    reasonSources: { exitRecord: e12.filter((e) => e.reason && (e as { reasonSource?: string }).reasonSource !== "legacy").length, legacy: e12.filter((e) => (e as { reasonSource?: string }).reasonSource === "legacy").length, none: e12.length - recorded },
    exitType: {
      voluntary: e12.filter((e) => t(e.exitType) === "voluntary").length,
      involuntary: e12.filter((e) => t(e.exitType) === "involuntary").length,
      unknown: e12.filter((e) => !["voluntary", "involuntary"].includes(t(e.exitType))).length,
    },
    reasonByBranch: (() => {
      const m = new Map<string, { id: string | null; label: string; exits: number; recorded: number }>();
      for (const e of e12) {
        const k = e.branchId ?? "none";
        const g = m.get(k) ?? m.set(k, { id: e.branchId, label: e.branch ?? "Unassigned", exits: 0, recorded: 0 }).get(k)!;
        g.exits++; if (e.reason) g.recorded++;
      }
      return [...m.values()].filter((g) => g.exits >= 5).map((g) => ({ ...g, pct: r1((g.recorded / g.exits) * 100) })).sort((x, y) => x.pct - y.pct).slice(0, 12);
    })(),
    monthlyBySource: [...src.entries()]
      .map(([source, v]) => ({ source, exits: v.exits, joiners: v.joiners, earlyExitRatePct: v.matured >= 10 ? r1((v.early / v.matured) * 100) : null }))
      .filter((x) => x.exits + x.joiners > 0).sort((x, y) => y.joiners - x.joiners).slice(0, 10),
  };
}

/* ── risk board ── */
export interface RiskFilters { tier?: Tier; group?: FactorGroup; branchId?: string; processId?: string; managerId?: string; q?: string; absentOnly?: boolean; newJoinerOnly?: boolean; sort?: "score" | "aon" | "name"; limit?: number; offset?: number }

export function toRiskRow(p: ScoredPerson, model: Model | null, last?: { kind: string; outcome: string; at: string } | null) {
  return {
    lastFollowup: last ?? null,
    employeeId: p.id, code: p.code, name: p.name, designation: p.designation, process: p.process, branch: p.branch, manager: p.manager,
    managerId: p.managerId, branchId: p.branchId, processId: p.processId, aonDays: p.aonDays,
    score: p.score, tier: p.tier, probability30: probOf(model, p.tier), factors: p.factors,
    reasons: p.reasons.slice(0, 4), actions: suggestActions(p.reasons, p.tier),
  };
}

export function buildRisk(people: ScoredPerson[], f: RiskFilters, model: Model | null, followups?: Map<string, { kind: string; outcome: string; at: string }>) {
  const pool = live(people).filter((p) =>
    (!f.branchId || p.branchId === f.branchId) && (!f.processId || p.processId === f.processId) && (!f.managerId || p.managerId === f.managerId) &&
    (!f.absentOnly || (p.features.absentStreak ?? 0) >= 2) && (!f.newJoinerOnly || p.aonDays <= 90) && (!f.group || p.factors[f.group] > 0) &&
    (!f.q || `${p.name} ${p.code}`.toLowerCase().includes(f.q.toLowerCase())));
  const tierCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<Tier, number>;
  for (const p of pool) tierCounts[p.tier]++;
  const picked = f.tier ? pool.filter((p) => p.tier === f.tier) : pool;
  const sorted = [...picked].sort(f.sort === "aon" ? (a, b) => a.aonDays - b.aonDays : f.sort === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.score - a.score || a.aonDays - b.aonDays);
  const limit = Math.min(Math.max(f.limit ?? 25, 1), 200), offset = Math.max(f.offset ?? 0, 0);

  const group = (idOf: (p: ScoredPerson) => string | null, labelOf: (p: ScoredPerson) => string | null) => {
    const m = new Map<string, { id: string | null; label: string; n: number; sum: number; high: number; exp: number }>();
    for (const p of pool) {
      const k = idOf(p) ?? "none";
      if (!m.has(k)) m.set(k, { id: idOf(p), label: labelOf(p) ?? "Unassigned", n: 0, sum: 0, high: 0, exp: 0 });
      const g = m.get(k)!; g.n++; g.sum += p.score; g.exp += model ? (probOf(model, p.tier) ?? model.baseRatePct / 100) : 0;
      if (p.tier === "HIGH" || p.tier === "CRITICAL") g.high++;
    }
    return [...m.values()].filter((g) => g.n >= 3)
      .map((g) => ({ id: g.id, label: g.label, headcount: g.n, avgScore: r1(g.sum / g.n), highRisk: g.high, expectedExits30: r1(g.exp) }))
      .sort((x, y) => y.highRisk - x.highRisk || y.avgScore - x.avgScore).slice(0, 10);
  };

  const high = pool.filter((p) => p.tier === "HIGH" || p.tier === "CRITICAL");
  const avgPts = FACTOR_GROUP_ORDER.map((g) => ({ group: g as FactorGroup, avgPoints: high.length ? r1(high.reduce((s, p) => s + p.factors[g], 0) / high.length) : 0 }));
  const totalPts = avgPts.reduce((s, d) => s + d.avgPoints, 0);
  return {
    total: picked.length, rows: sorted.slice(offset, offset + limit).map((p) => toRiskRow(p, model, followups?.get(p.id))), tierCounts,
    groups: { manager: group((p) => p.managerId, (p) => p.manager), process: group((p) => p.processId, (p) => p.process), branch: group((p) => p.branchId, (p) => p.branch) },
    drivers: avgPts.map((d) => ({ ...d, sharePct: totalPts ? r1((d.avgPoints / totalPts) * 100) : 0 })),
  };
}

export function buildEmployeeRisk(p: ScoredPerson, model: Model | null, last?: { kind: string; outcome: string; at: string } | null) {
  const f = p.features;
  const fired = (label: string) => p.reasons.some((r) => r.label === label);
  const pct = (v: number | null | undefined) => (v == null ? "No data" : `${r1(v)}%`);
  const signals = [
    { label: "Days since joining", value: String(p.aonDays), flag: p.aonDays <= 180 },
    { label: "Attendance (60 days)", value: pct(f.att60Pct), flag: fired("Low attendance") },
    { label: "Attendance trend", value: f.attDeltaPts == null ? "No data" : `${f.attDeltaPts > 0 ? "+" : ""}${r1(f.attDeltaPts)} pts vs prior 30 days`, flag: fired("Attendance falling") },
    { label: "Absent streak", value: `${f.absentStreak ?? 0} day(s)`, flag: fired("Absent streak") || fired("Absent two days running") },
    { label: "Late marks (30 days)", value: f.late30 == null ? "No data" : String(f.late30), flag: fired("Repeated late marks") },
    { label: "Leave applications (60 days)", value: String(f.leaveCount60 ?? 0), flag: fired("Frequent leave") },
    { label: "Regularisations (60 days)", value: String(f.reg60 ?? 0), flag: fired("Many regularisations") },
    { label: "Latest KPI score", value: f.kpiScore == null ? "Not scored" : String(r1(f.kpiScore)), flag: fired("Low KPI score") },
    { label: "KPI change vs previous period", value: f.kpiDelta == null ? "No data" : `${f.kpiDelta > 0 ? "+" : ""}${r1(f.kpiDelta)}`, flag: fired("KPI score dropping") },
    { label: "Call quality (60 days)", value: f.quality60 == null ? "Not audited" : `${r1(f.quality60)}%`, flag: fired("Low call quality") },
    { label: "Pay vs designation average", value: f.peerCtcRatio == null ? "No peer data" : `${Math.round(f.peerCtcRatio * 100)}%`, flag: fired("Paid below peers") },
    { label: "Months since increment", value: f.monthsSinceIncrement == null ? "None on record" : String(Math.round(f.monthsSinceIncrement)), flag: fired("No increment in 18+ months") || fired("No increment in a year") || fired("No increment on record") },
    { label: "Active warnings", value: String(f.warningCount ?? 0), flag: fired("Active warning") },
    { label: "Performance improvement plan", value: f.activePip ? "Active" : "None", flag: fired("On a PIP") },
    { label: "Profile items missing", value: f.hygieneMissing == null ? "No data" : `${f.hygieneMissing} of 5`, flag: fired("Profile gaps") },
    { label: "Manager's team losses (90 days)", value: f.teamExitRate90 == null ? "Small team" : `${Math.round(f.teamExitRate90 * 100)}%`, flag: fired("Team is losing people") },
  ];
  return { row: toRiskRow(p, model, last), signals };
}

/* ── alerts ── */
export interface AlertOut {
  id: string; severity: "critical" | "warning" | "info";
  category: "risk" | "early-attrition" | "hotspot" | "manager" | "absence" | "data";
  title: string; detail: string; metric?: { label: string; value: string }; employeeCount?: number;
  link?: { tier?: Tier; branchId?: string; processId?: string; managerId?: string; absentOnly?: boolean; newJoinerOnly?: boolean };
}

export function buildAlerts(a: { asOf: string; people: ScoredPerson[]; exits: ExitRow[]; events: Events; model: Model | null; degraded: string[] }) {
  const { asOf, people, exits, model } = a;
  const out: AlertOut[] = [];
  const lp = live(people);
  const nCrit = lp.filter((p) => p.tier === "CRITICAL").length;
  const nHigh = lp.filter((p) => p.tier === "HIGH").length;
  if (nCrit) out.push({ id: "risk-critical", severity: "critical", category: "risk", title: `${nCrit} ${nCrit === 1 ? "person is" : "people are"} at critical attrition risk`,
    detail: "Several strong warning signs at once. A manager conversation this week is the best-known way to change the outcome.", employeeCount: nCrit,
    metric: { label: "Observed 30-day exit rate", value: model?.calibration.find((c) => c.tier === "CRITICAL")?.observedRatePct != null ? `${model!.calibration.find((c) => c.tier === "CRITICAL")!.observedRatePct}%` : "n/a" }, link: { tier: "CRITICAL" } });
  if (nHigh) out.push({ id: "risk-high", severity: "warning", category: "risk", title: `${nHigh} ${nHigh === 1 ? "person is" : "people are"} at high attrition risk`,
    detail: "Multiple signals are pointing the same way. Review the reasons and plan retention actions.", employeeCount: nHigh, link: { tier: "HIGH" } });

  const absent = lp.filter((p) => (p.features.absentStreak ?? 0) >= 3);
  if (absent.length) {
    const share = lp.length ? (absent.length / lp.length) * 100 : 0;
    const fresh = absent.filter((p) => p.aonDays <= 30).length;
    // A very large share is either a real batch drop-out or a gap in the attendance feed; say so rather than guess.
    const bigShare = share >= 25 && absent.length >= 15;
    out.push({ id: "absence-streak", severity: "critical", category: "absence", title: `${absent.length} ${absent.length === 1 ? "employee has" : "employees have"} been absent 3+ days in a row`,
      detail: `Possible absconding: ${r1(share)}% of the people in view missed their last 3+ rostered days with no leave, ${fresh} of them in their first 30 days. Reach out and record the outcome before the notice process has to start.` +
        (bigShare ? " This is a large share - if it looks too high, check that clock-ins are being recorded for these people before acting on every name." : ""),
      metric: { label: "Share of headcount", value: `${r1(share)}%` }, employeeCount: absent.length, link: { absentOnly: true } });
  }

  const newHigh = lp.filter((p) => p.aonDays <= 90 && (p.tier === "HIGH" || p.tier === "CRITICAL"));
  if (newHigh.length) out.push({ id: "new-joiner-risk", severity: "warning", category: "early-attrition", title: `${newHigh.length} new ${newHigh.length === 1 ? "joiner is" : "joiners are"} already showing risk`,
    detail: "Joined in the last 90 days and already scoring high. First-90-day check-ins and a buddy usually help most here.", employeeCount: newHigh.length, link: { newJoinerOnly: true } });

  // early-exit spike: last 30 days vs the average of the three months before
  const early = (from: string, to: string) => exits.filter((e) => e.tenureDays <= 90 && inWindow(e.exitDate, from, to)).length;
  const recent = early(addDays(asOf, -30), asOf);
  const prior = early(addDays(asOf, -120), addDays(asOf, -30)) / 3;
  if (recent >= 3 && prior > 0 && recent >= prior * 1.5) {
    const sev = recent >= prior * 2 && recent >= 5 ? "critical" : "warning";
    out.push({ id: "early-attrition-spike", severity: sev, category: "early-attrition", title: "Early attrition is rising",
      detail: `${recent} people left within 90 days of joining in the last 30 days, against a recent average of ${r1(prior)} a month.`,
      metric: { label: "vs recent average", value: `${r1(recent / prior)}x` } });
  }

  // hotspots by dimension
  const ins = buildInsights({ asOf, people, exits, events: a.events });
  const dims: [keyof typeof ins.hotspots, string, "branchId" | "processId" | "managerId" | null][] = [
    ["branch", "Branch", "branchId"], ["process", "Process", "processId"], ["manager", "Manager's team", "managerId"], ["designation", "Designation", null],
  ];
  for (const [d, name, key] of dims) {
    for (const h of ins.hotspots[d]) {
      if (h.vsCompany == null || h.vsCompany < 2 || h.exits90 < 3) continue;
      const link = key && h.id ? ({ [key]: h.id } as AlertOut["link"]) : undefined;
      out.push({ id: `hotspot-${d}-${h.id ?? h.label}`, severity: h.vsCompany >= 3 && h.exits90 >= 5 ? "critical" : "warning", category: d === "manager" ? "manager" : "hotspot",
        title: `${name} "${h.label}" is losing people ${h.vsCompany}x faster than the company`,
        detail: `${h.exits90} exits in 90 days on a headcount of ${h.headcount}; ${h.highRisk} more are at high risk now.`,
        metric: { label: "Annualised attrition", value: h.ratePct == null ? "n/a" : `${h.ratePct}%` }, employeeCount: h.highRisk || undefined, link });
    }
  }

  // teams concentrating risk
  const teams = new Map<string, { label: string; n: number; high: number }>();
  for (const p of lp) {
    if (!p.managerId) continue;
    const t = teams.get(p.managerId) ?? { label: p.manager ?? "Unknown manager", n: 0, high: 0 };
    t.n++; if (p.tier === "HIGH" || p.tier === "CRITICAL") t.high++; teams.set(p.managerId, t);
  }
  for (const [id, t] of teams) {
    if (t.high >= 3 && t.high / t.n >= 0.25 && !out.some((o) => o.id === `hotspot-manager-${id}`))
      out.push({ id: `team-risk-${id}`, severity: "warning", category: "manager", title: `${t.label}'s team has ${t.high} people at high risk`,
        detail: `${Math.round((t.high / t.n) * 100)}% of a team of ${t.n}. Worth a conversation with the manager about workload and handling.`, employeeCount: t.high, link: { managerId: id } });
  }

  // Half of all exits being absconding is the single biggest finding in the reason data; say it once, plainly.
  const e90r = exits.filter((e) => inWindow(e.exitDate, addDays(asOf, -90), asOf));
  const abs90 = e90r.filter((e) => /abscond/i.test(e.reason ?? "")).length;
  if (e90r.length >= 20 && abs90 / e90r.length >= 0.25) {
    out.push({ id: "absconding-share", severity: abs90 / e90r.length >= 0.4 ? "critical" : "warning", category: "absence", title: `${r1((abs90 / e90r.length) * 100)}% of the last 90 days' exits were absconding`,
      detail: `${abs90} of ${e90r.length} leavers stopped coming without notice. Catching the absent-streak list early is the main lever on attrition.`,
      metric: { label: "Absconding exits, 90 days", value: String(abs90) }, employeeCount: abs90 });
  }

  const inNotice = people.filter((p) => p.inNotice).length;
  if (inNotice) out.push({ id: "in-notice", severity: "info", category: "risk", title: `${inNotice} ${inNotice === 1 ? "person is" : "people are"} serving notice`, detail: "Already leaving, so left out of the risk scores. Plan replacements and handovers.", employeeCount: inNotice });
  const e12 = exits.filter((e) => inWindow(e.exitDate, addDays(asOf, -365), asOf));
  const cov = e12.length ? (e12.filter((e) => e.reason).length / e12.length) * 100 : null;
  if (cov != null && e12.length >= 10 && cov < 25) out.push({ id: "data-reasons", severity: "info", category: "data", title: "Exit reasons are rarely recorded",
    detail: `Only ${r1(cov)}% of the last 12 months' exits have a reason. Recording one on every exit makes the risk model and these insights sharper.`, metric: { label: "Reasons recorded", value: `${r1(cov)}%` } });
  if (a.degraded.length) out.push({ id: "data-degraded", severity: "info", category: "data", title: "Some signals were unavailable",
    detail: `The risk score ran without: ${a.degraded.join(", ")}. Scores for the affected signals count as zero.` });

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  out.sort((x, y) => rank[x.severity] - rank[y.severity] || (y.employeeCount ?? 0) - (x.employeeCount ?? 0));
  return { alerts: out, counts: { critical: out.filter((o) => o.severity === "critical").length, warning: out.filter((o) => o.severity === "warning").length, info: out.filter((o) => o.severity === "info").length } };
}

export { TIERS, FACTOR_CAPS };
