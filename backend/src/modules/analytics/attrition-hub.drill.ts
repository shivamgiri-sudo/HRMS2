/**
 * Attrition hub - drill-downs, joining-batch tracker, hiring-quality scorecard, 30-day outlook and
 * the crisp pulse card. Pure functions over already-loaded data (no I/O).
 */
import { addDays } from "./attrition-hub.data.js";
import { TENURE_BINS } from "./attrition-hub.builders.js";
import { bucketOf, probabilityFor, type EmpEvent, type ExitsData, type Model, type ScoredPerson } from "./attrition-hub.service.js";
import { FACTOR_GROUP_ORDER, type FactorGroup, type Tier } from "./attrition-model.js";

const r1 = (v: number) => Math.round(v * 10) / 10;
const dayMs = 86_400_000;
const diff = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / dayMs);
const pctOf = (n: number, d: number) => (d > 0 ? r1((n / d) * 100) : null);

/* ── drill ── */
export interface DrillFilters {
  population: "active" | "exits" | "joiners";
  tier?: Tier; group?: FactorGroup; branchId?: string; processId?: string; managerId?: string; designationId?: string; source?: string;
  absentOnly?: boolean; minAbsentStreak?: number; newJoinerOnly?: boolean; notice?: boolean; followup?: "none" | "any";
  aonBucket?: string; tenureBin?: string; month?: string; reason?: string; noReason?: boolean; exitType?: string;
  joinWeek?: string; windowDays?: number; q?: string; sort?: "score" | "aon" | "name" | "date"; limit?: number; offset?: number;
}
export type LastFollowup = { kind: string; outcome: string; at: string };

const weekStartOf = (date: string) => { const d = new Date(`${date}T00:00:00`); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const norm = (s: string | null) => (s ?? "").replace(/_/g, " ").trim().toLowerCase();

export function buildDrill(a: { asOf: string; filters: DrillFilters; people: ScoredPerson[]; events: EmpEvent[]; model: Model | null; followups: Map<string, LastFollowup> }) {
  const { asOf, filters: f, people, events, model, followups } = a;
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200), offset = Math.max(f.offset ?? 0, 0);
  const text = (f.q ?? "").trim().toLowerCase();
  const dimOk = (x: { branchId?: string | null; processId?: string | null; managerId?: string | null; designationId?: string | null; source?: string | null }) =>
    (!f.branchId || x.branchId === f.branchId) && (!f.processId || x.processId === f.processId) && (!f.managerId || x.managerId === f.managerId) &&
    (!f.designationId || x.designationId === f.designationId) && (!f.source || (x.source?.trim() || "Unknown") === f.source);

  if (f.population === "active") {
    const noticeById = new Map(people.map((p) => [p.id, p.inNotice]));
    const designationOf = new Map(events.map((e) => [e.id, e.designationId]));
    const pool = people.filter((p) =>
      (f.notice ? p.inNotice : !p.inNotice) &&
      dimOk({ branchId: p.branchId, processId: p.processId, managerId: p.managerId, designationId: p.designationId ?? designationOf.get(p.id) ?? null, source: p.source }) &&
      (!f.tier || p.tier === f.tier) && (!f.group || p.factors[f.group] > 0) &&
      (!f.absentOnly || (p.features.absentStreak ?? 0) >= 2) && (!f.minAbsentStreak || (p.features.absentStreak ?? 0) >= f.minAbsentStreak) && (!f.newJoinerOnly || p.aonDays <= 90) &&
      (!f.aonBucket || bucketOf(p.aonDays) === f.aonBucket) &&
      (!f.followup || (f.followup === "none" ? !followups.has(p.id) : followups.has(p.id))) &&
      (!text || `${p.name} ${p.code}`.toLowerCase().includes(text)));
    const sorted = [...pool].sort(f.sort === "aon" ? (x, y) => x.aonDays - y.aonDays : f.sort === "name" ? (x, y) => x.name.localeCompare(y.name) : (x, y) => y.score - x.score || x.aonDays - y.aonDays);
    const tiers = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<Tier, number>;
    let exp = 0, sum = 0;
    for (const p of pool) { tiers[p.tier]++; sum += p.score; exp += model ? (probabilityFor(model, p.tier) ?? model.baseRatePct / 100) : 0; }
    return {
      population: "active" as const, total: pool.length,
      rows: sorted.slice(offset, offset + limit).map((p) => ({
        employeeId: p.id, code: p.code, name: p.name, designation: p.designation, process: p.process, branch: p.branch, manager: p.manager,
        branchId: p.branchId, processId: p.processId, managerId: p.managerId, joinDate: p.joinDate, aonDays: p.aonDays,
        status: (noticeById.get(p.id) ? "notice" : "active") as "notice" | "active",
        score: p.score, tier: p.tier, probability30: model ? probabilityFor(model, p.tier) : null, topReason: p.reasons[0]?.label ?? null,
        absentStreak: p.features.absentStreak ?? 0,
        lastFollowup: followups.get(p.id) ? { ...followups.get(p.id)! } : null,
      })),
      summary: [
        { label: "People", value: String(pool.length) },
        { label: "Average risk score", value: pool.length ? String(r1(sum / pool.length)) : "-" },
        { label: "Expected exits, next 30d", value: String(r1(exp)) },
        { label: "High + Critical", value: String(tiers.CRITICAL + tiers.HIGH) },
      ],
      mix: (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Tier[]).map((t) => ({ label: t[0] + t.slice(1).toLowerCase(), value: tiers[t] })),
    };
  }

  const noticeIds = new Set(people.filter((p) => p.inNotice).map((p) => p.id));
  const activeIds = new Set(people.map((p) => p.id));
  const win = f.windowDays ?? 365;
  const asRow = (e: EmpEvent) => {
    const tenureDays = e.exit ? diff(e.join, e.exit) : null;
    const status: "active" | "notice" | "left" = e.exit ? "left" : noticeIds.has(e.id) ? "notice" : "active";
    return {
      employeeId: e.id, code: e.code, name: e.name, designation: e.designation, process: e.process, branch: e.branch, manager: e.manager,
      branchId: e.branchId, processId: e.processId, managerId: e.managerId, joinDate: e.join,
      aonDays: tenureDays ?? Math.max(0, diff(e.join, asOf)), status, exitDate: e.exit, tenureDays, reason: e.reason, exitType: e.exitType, reasonSource: e.reasonSource ?? null,
    };
  };

  if (f.population === "exits") {
    const from = addDays(asOf, -win);
    const pool = events.filter((e) => {
      if (!e.exit || !(e.exit > from && e.exit <= asOf)) return false;
      const tenure = diff(e.join, e.exit);
      const type = norm(e.exitType);
      return dimOk(e) &&
        (!f.month || e.exit.startsWith(f.month)) &&
        (!f.aonBucket || bucketOf(tenure) === f.aonBucket) &&
        (!f.tenureBin || TENURE_BINS.find(([b]) => b === f.tenureBin)?.[1](tenure)) &&
        (!f.noReason || !e.reason) &&
        (!f.reason || (f.reason === "Not recorded" ? !e.reason : norm(e.reason) === norm(f.reason))) &&
        (!f.exitType || (f.exitType === "unknown" ? !["voluntary", "involuntary"].includes(type) : type === f.exitType)) &&
        (!text || `${e.name} ${e.code}`.toLowerCase().includes(text));
    });
    const sorted = [...pool].sort(f.sort === "aon" ? (x, y) => diff(x.join, x.exit!) - diff(y.join, y.exit!) : f.sort === "name" ? (x, y) => x.name.localeCompare(y.name) : (x, y) => (y.exit! < x.exit! ? -1 : 1));
    const tenures = pool.map((e) => diff(e.join, e.exit!));
    return {
      population: "exits" as const, total: pool.length, rows: sorted.slice(offset, offset + limit).map(asRow),
      summary: [
        { label: "People who left", value: String(pool.length) },
        { label: "Average tenure at exit", value: tenures.length ? `${Math.round(tenures.reduce((s, x) => s + x, 0) / tenures.length)} days` : "-" },
        { label: "Left within 90 days", value: `${pctOf(tenures.filter((t) => t <= 90).length, tenures.length) ?? "-"}%` },
        { label: "Reason recorded", value: `${pctOf(pool.filter((e) => e.reason).length, pool.length) ?? "-"}%` },
      ],
      mix: TENURE_BINS.map(([label, test]) => ({ label, value: tenures.filter(test).length })),
    };
  }

  // joiners: everyone who joined in the window (or in one batch week), whether still here or not
  const from = addDays(asOf, -win);
  const wkEnd = f.joinWeek ? addDays(f.joinWeek, 6) : null;
  const pool = events.filter((e) =>
    (f.joinWeek ? e.join >= f.joinWeek && e.join <= wkEnd! : e.join > from && e.join <= asOf) &&
    dimOk(e) && (!text || `${e.name} ${e.code}`.toLowerCase().includes(text)));
  const sorted = [...pool].sort(f.sort === "name" ? (x, y) => x.name.localeCompare(y.name) : (x, y) => (y.join < x.join ? -1 : 1));
  const left = pool.filter((e) => e.exit);
  const early = left.filter((e) => diff(e.join, e.exit!) <= 90).length;
  const matured90 = pool.filter((e) => diff(e.join, asOf) >= 90);
  return {
    population: "joiners" as const, total: pool.length, rows: sorted.slice(offset, offset + limit).map(asRow),
    summary: [
      { label: "Joined", value: String(pool.length) },
      { label: "Still employed", value: `${pool.length - left.length} (${pctOf(pool.length - left.length, pool.length) ?? "-"}%)` },
      { label: "Left within 90 days", value: `${early}` },
      { label: "90-day survival", value: matured90.length ? `${pctOf(matured90.filter((e) => !e.exit || diff(e.join, e.exit) > 90).length, matured90.length)}%` : "not old enough" },
    ],
    mix: [
      { label: "Active", value: pool.filter((e) => !e.exit && activeIds.has(e.id) && !noticeIds.has(e.id)).length },
      { label: "Notice", value: pool.filter((e) => !e.exit && noticeIds.has(e.id)).length },
      { label: "Left", value: left.length },
    ],
  };
}

/* ── joining batches ── */
const SURV_DAYS = [1, 3, 7, 15, 30, 60, 90] as const;
/** firstPresent: employee id -> days after joining of the first present / half-day record (null = none seen);
 *  seen: ids with at least one attendance record in their first 7 days. */
export function buildBatches(a: { asOf: string; events: EmpEvent[]; firstPresent: Map<string, number | null>; seen: Set<string>; absent?: Set<string>; weeks?: number }) {
  const { asOf, events, firstPresent, seen } = a;
  const absent = a.absent ?? new Set<string>();
  const weeks = a.weeks ?? 16;
  const thisWeek = weekStartOf(asOf);
  const starts: string[] = [];
  for (let i = 0; i < weeks; i++) starts.push(addDays(thisWeek, -7 * i));
  const byWeek = new Map<string, EmpEvent[]>();
  for (const e of events) {
    const w = weekStartOf(e.join);
    if (starts.includes(w)) (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(e);
  }
  const batches = starts.map((weekStart) => {
    const mem = byWeek.get(weekStart) ?? [];
    const weekEnd = addDays(weekStart, 6);
    const survival = {} as Record<string, number | null>;
    for (const n of SURV_DAYS) {
      const old = diff(weekEnd, asOf) >= n;  // the newest joiner of the batch is at least n days in
      survival[`d${n}`] = old && mem.length ? pctOf(mem.filter((e) => !e.exit || diff(e.join, e.exit) > n).length, mem.length) : null;
    }
    const showUp = {} as Record<string, number | null>;
    const denom = mem.filter((e) => seen.has(e.id));
    for (const n of [1, 3, 7]) {
      const old = diff(weekEnd, asOf) >= n;
      showUp[`d${n}`] = old && denom.length ? pctOf(denom.filter((e) => { const fp = firstPresent.get(e.id); return fp != null && fp <= n - 1; }).length, denom.length) : null;
    }
    const src = new Map<string, { joined: number; activeNow: number }>();
    for (const e of mem) { const k = e.source?.trim() || "Unknown"; const g = src.get(k) ?? src.set(k, { joined: 0, activeNow: 0 }).get(k)!; g.joined++; if (!e.exit) g.activeNow++; }
    return {
      weekStart, joined: mem.length, activeNow: mem.filter((e) => !e.exit).length, absentNow: mem.filter((e) => !e.exit && absent.has(e.id)).length,
      survival: survival as unknown as Record<"d1" | "d3" | "d7" | "d15" | "d30" | "d60" | "d90", number | null>,
      showUp: showUp as unknown as Record<"d1" | "d3" | "d7", number | null>,
      sources: [...src.entries()].map(([source, v]) => ({ source, ...v })).sort((x, y) => y.joined - x.joined).slice(0, 4),
    };
  }).filter((b) => b.joined > 0);
  return { batches };
}

/* ── hiring quality scorecard ── */
export function buildScorecard(a: { asOf: string; events: EmpEvent[]; by: "source" | "branch" | "process" | "designation" }) {
  const { asOf, events, by } = a;
  const from = addDays(asOf, -365);
  const joiners = events.filter((e) => e.join > from && e.join <= asOf);
  const keyOf = (e: EmpEvent): { id: string | null; label: string } =>
    by === "source" ? { id: e.source?.trim() || "Unknown", label: e.source?.trim() || "Unknown" }
    : by === "branch" ? { id: e.branchId, label: e.branch ?? "Unassigned" }
    : by === "process" ? { id: e.processId, label: e.process ?? "Unassigned" }
    : { id: e.designationId, label: e.designation ?? "Unassigned" };
  const measure = (mem: EmpEvent[]) => {
    const out = { joined: mem.length } as Record<string, number | null>;
    for (const n of [30, 60, 90]) {
      const old = mem.filter((e) => diff(e.join, asOf) >= n);
      out[`n${n}`] = old.length;
      out[`s${n}`] = pctOf(old.filter((e) => !e.exit || diff(e.join, e.exit) > n).length, old.length);
    }
    return out as { joined: number; s30: number | null; s60: number | null; s90: number | null; n30: number; n60: number; n90: number };
  };
  const groups = new Map<string, { id: string | null; label: string; mem: EmpEvent[] }>();
  for (const e of joiners) { const k = keyOf(e); const g = groups.get(k.id ?? "none") ?? groups.set(k.id ?? "none", { ...k, mem: [] }).get(k.id ?? "none")!; g.mem.push(e); }
  const rows = [...groups.values()].filter((g) => g.mem.length >= 5)
    .map((g) => ({ id: g.id, label: g.label, ...measure(g.mem) }))
    .sort((x, y) => (x.s90 ?? x.s60 ?? x.s30 ?? 101) - (y.s90 ?? y.s60 ?? y.s30 ?? 101)).slice(0, 25);
  const all = measure(joiners);
  return { by, rows, company: { s30: all.s30, s60: all.s60, s90: all.s90 } };
}

/* ── next 30 days ── */
export function buildOutlook(a: { people: ScoredPerson[]; data: Pick<ExitsData, "notice" | "planned">; model: Model | null }) {
  const { people, data, model } = a;
  const lp = people.filter((p) => !p.inNotice);
  const prob = (t: Tier) => (model ? (probabilityFor(model, t) ?? model.baseRatePct / 100) : 0);
  type Acc = { id: string | null; label: string; hc: number; exp: number; notice: number; planned: number };
  const group = (idOf: (x: { branchId: string | null; processId: string | null }) => string | null, labelOf: (x: { branch?: string | null; process?: string | null }) => string | null) => {
    const m = new Map<string, Acc>();
    const get = (id: string | null, label: string | null) => { const k = id ?? "none"; return m.get(k) ?? m.set(k, { id, label: label ?? "Unassigned", hc: 0, exp: 0, notice: 0, planned: 0 }).get(k)!; };
    for (const p of people) { const g = get(idOf(p), labelOf(p)); g.hc++; if (!p.inNotice) g.exp += prob(p.tier); }
    for (const n of data.notice) get(idOf(n), labelOf(n)).notice++;
    for (const j of data.planned) get(idOf(j), labelOf(j)).planned++;
    return [...m.values()].filter((g) => g.hc >= 5 || g.notice + g.planned > 0).map((g) => {
      const projected = Math.round(g.hc - g.exp - g.notice + g.planned);
      return { id: g.id, label: g.label, headcount: g.hc, expectedExits: r1(g.exp), noticeExits: g.notice, plannedJoiners: g.planned, projected, gapPct: g.hc > 0 ? r1(((projected - g.hc) / g.hc) * 100) : null };
    }).sort((x, y) => (x.gapPct ?? 0) - (y.gapPct ?? 0)).slice(0, 12);
  };
  const expected = lp.reduce((s, p) => s + prob(p.tier), 0);
  const notices = data.notice.length, planned = data.planned.length;
  const notes = [
    "Expected exits use the calibrated 30-day chance of each person not already serving notice.",
    "Notice exits are people with an open exit request whose last working day falls within 30 days, including overdue or undated ones. Planned joiners are employee records with a joining date in the next 30 days.",
  ];
  if (!model) notes.push("The calibration model is still warming up, so expected exits show as 0 for now.");
  return {
    horizonDays: 30 as const, headcount: people.length, expectedExits: r1(expected), noticeExits: notices, plannedJoiners: planned,
    projected: Math.round(people.length - expected - notices + planned),
    byBranch: group((x) => x.branchId, (x) => x.branch ?? null), byProcess: group((x) => x.processId, (x) => x.process ?? null), notes,
  };
}

export { FACTOR_GROUP_ORDER };

/* ── pulse: the crisp card for role dashboards ── */
export function buildPulse(a: {
  overview: { asOf: string; headcount: number; exits30: number; exitsPrev30: number; earlyExitSharePct: number | null; expectedExits30: number; atRisk: Record<Tier, number>; trend: { month: string; exits: number }[]; degraded: string[] };
  alerts: { alerts: { severity: "critical" | "warning" | "info" }[] };
  people: ScoredPerson[]; scope: "org" | "branch" | "team";
}) {
  const { overview: o, people } = a;
  const lp = people.filter((p) => !p.inNotice);
  const ranked = [...a.alerts.alerts].sort((x, y) => ({ critical: 0, warning: 1, info: 2 }[x.severity] - { critical: 0, warning: 1, info: 2 }[y.severity]));
  const real = ranked.filter((x) => x.severity !== "info");
  return {
    asOf: o.asOf, scope: a.scope, headcount: o.headcount, critical: o.atRisk.CRITICAL, high: o.atRisk.HIGH, expectedExits30: o.expectedExits30,
    absentStreak: lp.filter((p) => (p.features.absentStreak ?? 0) >= 3).length,
    newJoinerRisk: lp.filter((p) => p.aonDays <= 90 && (p.tier === "HIGH" || p.tier === "CRITICAL")).length,
    exits30: o.exits30, exitsPrev30: o.exitsPrev30, earlyExitSharePct: o.earlyExitSharePct,
    monthlyExits: o.trend.slice(-7, -1).map((t) => ({ month: t.month, exits: t.exits })),
    topAlerts: (real.length ? real : ranked).slice(0, 3), degraded: o.degraded,
  };
}
