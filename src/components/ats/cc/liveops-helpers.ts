import type { AtsOperations } from "@/hooks/useAtsDashboards";

/** Pure logic for the Live Ops tab: kept free of React so it can be unit tested. */
export type QueueRow = AtsOperations["queue"][number];
export type WaitTone = "ok" | "warn" | "crit";
export type FindingTone = "good" | "warn" | "bad" | "info";
export interface LiveFinding { tone: FindingTone; title: string; body?: string; drill?: { crumb: string; extra: Record<string, unknown>; live?: boolean } }

export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 45 -> "45m", 125 -> "2h 05m", 4000 -> "2d 19h". Invalid -> en dash. */
export function fmtWait(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min < 0) return "–";
  const r = Math.round(min);
  if (r < 60) return `${r}m`;
  const h = Math.floor(r / 60);
  if (h < 48) return `${h}h ${String(r % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** ok inside the SLA, warn past it, crit past twice the SLA. */
export function waitTone(waitMin: number, sla: number): WaitTone {
  if (waitMin >= sla * 2) return "crit";
  if (waitMin >= sla) return "warn";
  return "ok";
}

export const isBreach = (r: QueueRow, sla: number) => r.waitMin >= sla;

export type QueueMode = "all" | "breached";
/** Queue sorted longest wait first, optionally narrowed to breached rows and/or one branch. */
export function filterQueue(queue: QueueRow[], mode: QueueMode, sla: number, branch = ""): QueueRow[] {
  return queue
    .filter((r) => (!branch || r.branch === branch) && (mode === "all" || isBreach(r, sla)))
    .sort((a, b) => b.waitMin - a.waitMin);
}

/** Hour of day (0-23) in IST for an ISO timestamp; -1 when unparseable. */
export function istHour(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -1 : new Date(t + 19_800_000).getUTCHours();
}

const tally = (keys: string[]) => {
  const m = new Map<string, number>();
  keys.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1));
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
};

/** Currently breached queue rows grouped by arrival hour, branch and recruiter. */
export function groupBreaches(queue: QueueRow[], sla: number) {
  const b = queue.filter((r) => isBreach(r, sla));
  const hours = new Map<number, number>();
  b.forEach((r) => { const h = istHour(r.arrival); if (h >= 0) hours.set(h, (hours.get(h) ?? 0) + 1); });
  return {
    total: b.length,
    byHour: [...hours.entries()].map(([hour, n]) => ({ hour, n })).sort((x, y) => x.hour - y.hour),
    byBranch: tally(b.map((r) => r.branch || "Unspecified")),
    byRecruiter: tally(b.map((r) => r.recruiter || "Unassigned")),
  };
}

/** Logged SLA events per weekday (0=Sun) from the daily series. */
export function weekdayBreaches(daily: AtsOperations["sla"]["daily"]) {
  const acc = DOW_SHORT.map((label, dow) => ({ dow, label, events: 0, days: 0 }));
  daily.forEach((d) => {
    const t = Date.parse(`${String(d.date).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(t)) return;
    const a = acc[new Date(t).getUTCDay()];
    a.events += d.events; a.days += 1;
  });
  return acc.map((a) => ({ ...a, perDay: a.days ? Math.round((a.events / a.days) * 10) / 10 : 0 }));
}

export interface EscalationLike { level: 1 | 2 | 3; overSlaMin: number; runningMin?: number }
export function escalationCounts(list: EscalationLike[]) {
  return { l1: list.filter((e) => e.level === 1).length, l2: list.filter((e) => e.level === 2).length, l3: list.filter((e) => e.level === 3).length };
}
/** Highest level first, then most over SLA. */
export function sortEscalations<T extends EscalationLike>(list: T[]): T[] {
  return [...list].sort((a, b) => b.level - a.level || b.overSlaMin - a.overSlaMin);
}
export const LEVEL_LABEL: Record<1 | 2 | 3, string> = { 1: "L1 Recruiter", 2: "L2 Branch head", 3: "L3 HR head" };

/** Rate of `part` in `all` per key (weekday number / hour). Keys with fewer than `min` in `all` are dropped. */
export function rateByKey<K extends number>(all: { key: K; n: number }[], part: { key: K; n: number }[], min = 1) {
  const p = new Map<K, number>(part.map((x) => [x.key, x.n]));
  return all.filter((a) => a.n >= min).map((a) => ({ key: a.key, total: a.n, hit: p.get(a.key) ?? 0, rate: Math.round(((p.get(a.key) ?? 0) / a.n) * 1000) / 10 }));
}

export type Cell = { dow: number; hour: number; total: number };
export const SLOTS = [
  { label: "Before 10", from: 0, to: 9 }, { label: "10 to 12", from: 10, to: 11 }, { label: "12 to 3 pm", from: 12, to: 14 }, { label: "After 3 pm", from: 15, to: 23 },
];
/** Sum an arrival grid into the four day slots. */
export function slotTotals(grid: Cell[]) {
  return SLOTS.map((s) => ({ ...s, total: grid.filter((c) => c.hour >= s.from && c.hour <= s.to).reduce((x, c) => x + c.total, 0) }));
}
/** Busiest weekday/hour cells. dow is 1=Sun..7=Sat as the drill endpoint returns. */
export function peakCells(grid: Cell[], top = 3) {
  return [...grid].filter((c) => c.total > 0).sort((a, b) => b.total - a.total).slice(0, top);
}

export function capacityByBranch(roster: AtsOperations["roster"]) {
  const m = new Map<string, { branch: string; capacity: number; assigned: number; recruiters: number; available: number }>();
  roster.forEach((r) => {
    const k = r.branch || "Unspecified";
    const e = m.get(k) ?? { branch: k, capacity: 0, assigned: 0, recruiters: 0, available: 0 };
    e.capacity += r.capacity; e.assigned += r.assigned; e.recruiters += 1; if (r.available) e.available += 1;
    m.set(k, e);
  });
  return [...m.values()].map((e) => ({ ...e, util: e.capacity ? Math.round((e.assigned / e.capacity) * 100) : e.assigned ? 100 : 0 })).sort((a, b) => b.util - a.util);
}

/** Auto findings from the live snapshot. Order is severity first. */
export function buildLiveFindings(ops: AtsOperations, opts: { peakSlot?: string } = {}): LiveFinding[] {
  const out: LiveFinding[] = [];
  const sla = ops.slaMinutes, g = groupBreaches(ops.queue, sla);
  const crit = ops.queue.filter((r) => waitTone(r.waitMin, sla) === "crit").length;
  if (crit > 0) out.push({ tone: "bad", title: `${crit} waiting more than twice the ${sla}-minute SLA`, body: `Longest wait ${fmtWait(Math.max(...ops.queue.map((r) => r.waitMin)))}. Escalate these first.`, drill: { crumb: "Waiting today", extra: { outcome: "waiting" }, live: true } });
  if (g.byBranch[0] && g.total >= 3) {
    const share = Math.round((g.byBranch[0].n / g.total) * 100);
    if (share >= 50) out.push({ tone: "warn", title: `${g.byBranch[0].name} holds ${share}% of live breaches`, body: `${g.byBranch[0].n} of ${g.total} breached tokens.`, drill: { crumb: g.byBranch[0].name, extra: { branch: g.byBranch[0].name, outcome: "waiting" }, live: true } });
  }
  if (g.byRecruiter[0] && g.byRecruiter[0].n >= 3) out.push({ tone: "warn", title: `${g.byRecruiter[0].name} has ${g.byRecruiter[0].n} breached tokens`, body: "Check whether they are overloaded or away.", drill: { crumb: g.byRecruiter[0].name, extra: { recruiter: g.byRecruiter[0].name, outcome: "waiting" }, live: true } });
  const peak = [...g.byHour].sort((a, b) => b.n - a.n)[0];
  if (peak && peak.n >= 3) out.push({ tone: "info", title: `Breaches cluster among arrivals at ${peak.hour}:00`, body: `${peak.n} of ${g.total} breached tokens arrived in that hour.` });
  const free = ops.roster.filter((r) => r.available);
  const waiting = ops.today.waiting;
  if (waiting > 0 && free.length === 0 && ops.roster.length) out.push({ tone: "bad", title: "People are waiting and no recruiter is available", body: `${waiting} waiting against ${ops.roster.length} on the roster.` });
  const over = capacityByBranch(ops.roster).filter((c) => c.assigned > c.capacity && c.capacity > 0);
  if (over.length) out.push({ tone: "warn", title: `${over.length} branch${over.length > 1 ? "es" : ""} above recruiter capacity`, body: over.slice(0, 3).map((c) => `${c.branch} ${c.assigned}/${c.capacity}`).join(", ") });
  const nowH = ops.hourly.filter((h) => h.today > 0).slice(-1)[0];
  const doneY = nowH ? ops.hourly.filter((h) => h.hour <= nowH.hour).reduce((s, h) => s + h.yesterday, 0) : 0;
  if (nowH && doneY >= 10) {
    const t = ops.hourly.reduce((s, h) => s + h.today, 0), ch = Math.round(((t - doneY) / doneY) * 100);
    if (Math.abs(ch) >= 25) out.push({ tone: ch > 0 ? "warn" : "info", title: `Arrivals ${ch > 0 ? "+" : ""}${ch}% against yesterday by this hour`, body: `${t} today against ${doneY}.` });
  }
  if (opts.peakSlot) out.push({ tone: "info", title: `Busiest arrival slot in the period: ${opts.peakSlot}`, body: "Staff recruiters to this window." });
  if (out.length === 0 && ops.today.breach === 0) out.push({ tone: "good", title: "No SLA breaches right now" });
  return out.slice(0, 7);
}
