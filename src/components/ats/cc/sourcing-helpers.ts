import type { DrillData, DrillSplit } from "@/hooks/useAtsDashboards";

/** Pure maths for the Sourcing & Recruiters tab. No React, no network, so every rule here is unit-tested. */

/** Percentage with one decimal; 0 when the base is empty. */
export const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
export const round0 = (n: number): number => Math.round(n);

export function median(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Best source by `rate`, only among sources with at least `minN` rows in the denominator. */
export function bestSource<T extends { name: string }>(rows: T[], n: (r: T) => number, rate: (r: T) => number, minN = 10): T | null {
  const ok = rows.filter((r) => n(r) >= minN);
  return ok.length ? ok.reduce((a, b) => (rate(b) > rate(a) ? b : a)) : null;
}

export interface RecruiterStats {
  name: string; handled: number; selected: number; rejected: number; joined: number;
  selRate: number; joinRate: number; showUp: number; decidedRate: number;
}

/** Normalises a drill split row (newer backend fields optional) into one recruiter record. */
export function toStats(s: DrillSplit): RecruiterStats {
  const joined = s.joined ?? 0;
  const noShow = s.noShow ?? (s.noShowRate != null ? Math.round((s.noShowRate / 100) * s.total) : 0);
  const open = (s.waiting ?? 0) + (s.hold ?? 0);
  return {
    name: s.name, handled: s.total, selected: s.selected, rejected: s.rejected, joined,
    selRate: s.selRate ?? pct(s.selected, s.total),
    joinRate: s.joinRate ?? pct(joined, s.selected),
    showUp: s.noShowRate != null ? Math.round((100 - s.noShowRate) * 10) / 10 : pct(s.total - noShow, s.total),
    decidedRate: pct(Math.max(0, s.total - open), s.total),
  };
}

export function statsFromKpis(name: string, k: DrillData["kpis"]): RecruiterStats {
  return toStats({ name, total: k.total, selected: k.selected, rejected: k.rejected, selRate: k.selRate, noShow: k.noShow, hold: k.hold, waiting: k.waiting, joined: k.joined, joinRate: k.joinRate, noShowRate: k.noShowRate });
}

/** Rank by selections, then selection rate, then volume. Recruiters under `minHandled` are listed last, never dropped. */
export function rankRecruiters(rows: RecruiterStats[], minHandled = 5): (RecruiterStats & { rank: number; thin: boolean })[] {
  const scored = rows.map((r) => ({ ...r, thin: r.handled < minHandled }));
  scored.sort((a, b) => Number(a.thin) - Number(b.thin) || b.selected - a.selected || b.selRate - a.selRate || b.handled - a.handled || a.name.localeCompare(b.name));
  return scored.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Peer baseline: per-metric median across recruiters with enough volume (others would drag every median to zero). */
export function peerMedian(rows: RecruiterStats[], minHandled = 5): RecruiterStats {
  const base = rows.filter((r) => r.handled >= minHandled);
  const use = base.length ? base : rows;
  return {
    name: "Peer median", handled: median(use.map((r) => r.handled)), selected: median(use.map((r) => r.selected)), rejected: median(use.map((r) => r.rejected)), joined: median(use.map((r) => r.joined)),
    selRate: median(use.map((r) => r.selRate)), joinRate: median(use.map((r) => r.joinRate)), showUp: median(use.map((r) => r.showUp)), decidedRate: median(use.map((r) => r.decidedRate)),
  };
}

export const RADAR_AXES = ["Selection %", "Join %", "Show-up %", "Volume index", "Speed"];

/**
 * Five 0..100 axes. Selection, join and show-up are the rates themselves. Volume index puts the peer median at 50 and
 * saturates at twice the median. Speed is the share of handled candidates already decided (not waiting or on hold).
 */
export function radarValues(r: RecruiterStats, peer: RecruiterStats): number[] {
  const vol = peer.handled > 0 ? Math.min(100, (r.handled / peer.handled) * 50) : r.handled > 0 ? 50 : 0;
  const c = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  return [c(r.selRate), c(r.joinRate), c(r.showUp), c(vol), c(r.decidedRate)];
}

export type FindingKey = "selection" | "join" | "showup" | "volume" | "speed" | "good" | "thin";
export interface Finding { tone: "good" | "warn" | "bad" | "info"; key: FindingKey; title: string; body: string }

const pts = (n: number) => `${Math.abs(Math.round(n * 10) / 10)} pts`;

/** Plain-language findings against the peer median. Gaps under 5 points are noise and stay silent. */
export function recruiterFindings(r: RecruiterStats, peer: RecruiterStats, minHandled = 5): Finding[] {
  if (r.handled < minHandled) return [{ tone: "info", key: "thin", title: `Only ${r.handled} candidates handled`, body: "Too few to compare with peers reliably." }];
  const out: Finding[] = [];
  const gap = (v: number, p: number, key: FindingKey, label: string, high: "good" | "warn", low: "bad" | "warn") => {
    const d = v - p;
    if (Math.abs(d) < 5) return;
    out.push(d > 0
      ? { tone: high, key, title: `${label} ${pts(d)} above peers`, body: `${Math.round(v * 10) / 10}% against a peer median of ${Math.round(p * 10) / 10}%.` }
      : { tone: low, key, title: `${label} ${pts(d)} below peers`, body: `${Math.round(v * 10) / 10}% against a peer median of ${Math.round(p * 10) / 10}%.` });
  };
  gap(r.selRate, peer.selRate, "selection", "Selection", "good", "bad");
  if (r.selected >= 3) gap(r.joinRate, peer.joinRate, "join", "Join rate", "good", "warn");
  gap(r.showUp, peer.showUp, "showup", "Show-up", "good", "warn");
  if (peer.handled > 0) {
    const ratio = r.handled / peer.handled;
    if (ratio >= 1.5) out.push({ tone: "info", key: "volume", title: `Handles ${Math.round(ratio * 10) / 10}x the peer median volume`, body: `${r.handled} candidates against ${Math.round(peer.handled)}.` });
    else if (ratio <= 0.5) out.push({ tone: "info", key: "volume", title: `Handles under half the peer median volume`, body: `${r.handled} candidates against ${Math.round(peer.handled)}.` });
  }
  gap(r.decidedRate, peer.decidedRate, "speed", "Decided share", "good", "warn");
  if (!out.length) out.push({ tone: "good", key: "good", title: "In line with peers on every measure", body: "No gap of 5 points or more." });
  return out;
}

/** Share of a month series: latest month against the one before, for source momentum. */
export function momentum(trend: Record<string, number | string>[], names: string[], nowMonth = currentMonthIst()) {
  // The month still in progress is a few days of data; comparing it with a full month always reads as a collapse.
  const done = trend.filter((row) => String(row.month ?? "").slice(0, 7) !== nowMonth);
  const last2 = done.slice(-2);
  if (last2.length < 2) return [];
  return names.map((name) => {
    const prev = Number(last2[0][name] ?? 0), last = Number(last2[1][name] ?? 0);
    return { name, prev, last, change: prev ? Math.round(((last - prev) / prev) * 100) : null };
  }).filter((m) => m.prev || m.last);
}

/** Rows for the reusable pool, tolerant of missing fields. */
export interface PoolRow { id: string; name: string; branch: string; quality: string; reason: string }
export function poolRows(raw: unknown): PoolRow[] {
  if (!Array.isArray(raw)) return [];
  const s = (v: unknown) => (v == null ? "" : String(v));
  return raw.map((r: Record<string, unknown>) => ({ id: s(r.CandidateID), name: s(r.FullName), branch: s(r.Branch), quality: s(r._candidateQualityLabel), reason: s(r._reusableReason) }));
}

/** YYYY-MM of today in India time (the app's calendar). */
export function currentMonthIst(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
}

/** Roles that arrive as raw database ids carry no readable name, so they are left out of name lists. */
export const isRawId = (label: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(label ?? "").trim());

/** Candidates nobody owns are a data gap, not a recruiter: they are reported beside the leaderboard, never ranked in it. */
export const isUnowned = (name: string) => ["Unspecified", "Unmapped", "Unassigned"].includes(name);
