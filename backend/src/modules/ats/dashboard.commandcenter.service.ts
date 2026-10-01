import { createSwrCache } from './dashboard.cache.js';
import { JOINED, OFFERED, num, pct, q, safe } from './dashboard.overview.service.js';
import { getJoinedInfo, joinedIdSql } from './dashboard.joined.js';
import { rawValues } from './dashboard.scope.js';
import { OPEN_STATUSES, where, type PipelineFilters } from './dashboard.pipeline.service.js';

/** Command-centre aggregates: stage dwell, registration cohorts, funnel leakage. All share the drill's row scope via where(). */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cache = createSwrCache<Record<string, unknown>>({ freshMs: 60_000, staleMs: 10 * 60_000 });
const keyOf = (name: string, f: PipelineFilters, extra = '') => name + extra + JSON.stringify({ ...f, scope: f.scope?.params }) + (f.scope?.sql ?? '');
const needsRaw = (f: PipelineFilters) => !!(f.experience || f.education || f.process || f.recruiter);

/* ───────────── Stage dwell ───────────── */
export interface StageLogRow { candidate_id: string; to_stage: string; at: number; status: string }
export interface DwellStage { stage: string; n: number; medianHours: number; p90Hours: number; avgHours: number; stuckOver72h: number }
const HOUR_MS = 3_600_000;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Dwell = next log row's time minus the row that entered the stage; the candidate's last row is open (NOW - entry) only while the status is open. */
export function computeDwell(rows: StageLogRow[], nowMs: number, openStatuses: readonly string[] = OPEN_STATUSES, minBottleneckN = 20) {
  const byCand = new Map<string, StageLogRow[]>();
  for (const r of rows) { const a = byCand.get(r.candidate_id); if (a) a.push(r); else byCand.set(r.candidate_id, [r]); }
  const acc = new Map<string, { hours: number[]; stuck: number }>();
  const add = (stage: string, hrs: number, stuck: boolean) => {
    if (!stage || !(hrs >= 0)) return;
    const x = acc.get(stage) ?? { hours: [], stuck: 0 };
    x.hours.push(hrs); if (stuck) x.stuck += 1; acc.set(stage, x);
  };
  for (const list of byCand.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 0; i < list.length; i++) {
      const cur = list[i], next = list[i + 1];
      if (next) add(cur.to_stage, (next.at - cur.at) / HOUR_MS, false);
      else if (openStatuses.includes(cur.status)) { const h = (nowMs - cur.at) / HOUR_MS; add(cur.to_stage, h, h > 72); }
    }
  }
  const stages: DwellStage[] = [...acc.entries()].map(([stage, x]) => {
    const s = [...x.hours].sort((a, b) => a - b);
    return { stage, n: s.length, medianHours: r1(percentile(s, 0.5)), p90Hours: r1(percentile(s, 0.9)), avgHours: r1(s.reduce((a, b) => a + b, 0) / s.length), stuckOver72h: x.stuck };
  }).sort((a, b) => b.medianHours - a.medianHours);
  const elig = stages.filter((s) => s.n >= minBottleneckN);
  return { stages, bottleneck: elig.length ? elig[0].stage : null };
}

async function computeDwell_(f: PipelineFilters) {
  const raw = needsRaw(f) ? await rawValues() : undefined;
  const joinedIds = f.outcome === 'joined' ? (await getJoinedInfo()).ids : undefined;
  const w = where(f, { raw, joinedIds });
  // Bounded fetch: last 90 days of log activity unless a from-date narrows/widens it.
  const fromSql = f.from && DATE_RE.test(f.from) ? f.from : null;
  const logWin = fromSql ? 'COALESCE(l.stage_date, l.created_at) >= ?' : 'COALESCE(l.stage_date, l.created_at) >= DATE_SUB(NOW(), INTERVAL 90 DAY)';
  const rows = await safe('stageDwell', () => q<{ candidate_id: string; to_stage: string; at: number; status: string }>(
    `SELECT l.candidate_id, l.to_stage, UNIX_TIMESTAMP(COALESCE(l.stage_date, l.created_at)) * 1000 AS at, c.status
     FROM ats_candidate_stage_log l JOIN ats_candidate c ON c.id = l.candidate_id
     WHERE ${w.sql} AND ${logWin} AND l.to_stage IS NOT NULL
     ORDER BY l.candidate_id, COALESCE(l.stage_date, l.created_at) LIMIT 200000`, fromSql ? [...w.params, fromSql] : w.params), []);
  const out = computeDwell(rows.map((r) => ({ candidate_id: String(r.candidate_id), to_stage: String(r.to_stage), at: num(r.at), status: String(r.status) })), Date.now());
  return { generatedAt: new Date().toISOString(), ...out };
}
export const getStageDwell = (f: PipelineFilters) => cache.get(keyOf('dwell', f), () => computeDwell_(f));

/* ───────────── Cohorts ───────────── */
export interface CohortRow { week: string; status: string; stage: string; jn: number; n: number }
export const mondayOf = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
export const clampWeeks = (v: unknown) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(26, Math.max(4, n)) : 12; };
export const weekStarts = (weeks: number, now = new Date()) => {
  const m = mondayOf(now); const out: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) { const d = new Date(m); d.setUTCDate(d.getUTCDate() - i * 7); out.push(d.toISOString().slice(0, 10)); }
  return out;
};
const median = (xs: number[]) => (xs.length ? r1(percentile([...xs].sort((a, b) => a - b), 0.5)) : null);

export function buildCohorts(weeks: string[], rows: CohortRow[], decisionDays: { week: string; days: number }[]) {
  const m = new Map(weeks.map((w) => [w, { total: 0, selected: 0, rejected: 0, noShow: 0, open: 0, joined: 0 }]));
  for (const r of rows) {
    const x = m.get(r.week); if (!x) continue;
    const n = num(r.n);
    x.total += n;
    if (r.status === 'Selected' || OFFERED.includes(r.stage)) x.selected += n;
    if (r.status === 'Rejected') x.rejected += n;
    if (r.status === 'No Show') x.noShow += n;
    if (OPEN_STATUSES.includes(r.status)) x.open += n;
    if (r.jn || JOINED.includes(r.stage)) x.joined += n;
  }
  const dd = new Map<string, number[]>();
  for (const d of decisionDays) { if (d.days >= 0) { const a = dd.get(d.week); if (a) a.push(d.days); else dd.set(d.week, [d.days]); } }
  return weeks.map((week) => {
    const x = m.get(week)!;
    return { week, ...x, selRate: pct(x.selected, x.total), rejRate: pct(x.rejected, x.total), noShowRate: pct(x.noShow, x.total), joinRate: pct(x.joined, x.selected), medianDaysToDecision: median(dd.get(week) ?? []) };
  });
}

async function computeCohorts(f: PipelineFilters, weeksN: number) {
  const weeks = weekStarts(weeksN);
  const to = new Date().toISOString().slice(0, 10);
  const ff: PipelineFilters = { ...f, from: weeks[0], to };
  const raw = needsRaw(ff) ? await rawValues() : undefined;
  const joinedIds = (await getJoinedInfo()).ids;
  const jsql = joinedIdSql('c.id', joinedIds);
  const w = where(ff, { raw, joinedIds });
  const WK = `DATE_FORMAT(DATE_SUB(DATE(c.created_at), INTERVAL WEEKDAY(c.created_at) DAY), '%Y-%m-%d')`;
  const [rows, dec] = await Promise.all([
    q<CohortRow>(`SELECT ${WK} week, c.status, c.current_stage stage, (${jsql.sql}) jn, COUNT(*) n
                  FROM ats_candidate c WHERE ${w.sql} GROUP BY week, c.status, c.current_stage, jn`, [...jsql.params, ...w.params]),
    safe('cohortDecision', () => q<{ week: string; days: number }>(
      `SELECT ${WK} week, TIMESTAMPDIFF(HOUR, c.created_at, s.at) / 24 days
       FROM ats_candidate c JOIN (SELECT candidate_id, MIN(submitted_at) at FROM ats_interview_submission
            WHERE final_decision IN ('Selected','Rejected','No Show') GROUP BY candidate_id) s ON s.candidate_id = c.id
       WHERE ${w.sql} AND s.at >= c.created_at LIMIT 50000`, w.params), []),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    cohorts: buildCohorts(weeks, rows.map((r) => ({ week: String(r.week), status: r.status, stage: r.stage, jn: num(r.jn), n: num(r.n) })), dec.map((r) => ({ week: String(r.week), days: num(r.days) }))),
  };
}
export const getCohorts = (f: PipelineFilters, weeks: unknown) => { const n = clampWeeks(weeks); return cache.get(keyOf('cohorts', f, String(n)), () => computeCohorts(f, n)); };

/* ───────────── Leakage ───────────── */
export const LEAK_STAGES = [
  { key: 'registered', label: 'Registered' }, { key: 'selected', label: 'Selected' }, { key: 'offerMade', label: 'Offer made' },
  { key: 'offerApproved', label: 'Offer approved' }, { key: 'bgvClear', label: 'BGV clear' }, { key: 'joined', label: 'Joined' },
] as const;
export interface LeakRow { status: string; stage: string; jn: number; made: number; appr: number; rej: number; clr: number; bad: number; n: number }

/** Stages are cumulative: reaching a later stage implies the earlier ones, so the funnel is monotone non-increasing. */
export function buildLeakage(rows: LeakRow[]) {
  const counts = [0, 0, 0, 0, 0, 0];
  const loss = new Map<string, { from: string; to: string; reason: string; n: number }>();
  const lose = (i: number, reason: string, n: number) => {
    const k = `${i}|${reason}`, x = loss.get(k) ?? { from: LEAK_STAGES[i].key, to: LEAK_STAGES[i + 1].key, reason, n: 0 };
    x.n += n; loss.set(k, x);
  };
  for (const r of rows) {
    const n = num(r.n);
    const joined = !!r.jn || JOINED.includes(r.stage);
    const clear = !!r.clr || joined;
    const approved = !!r.appr || clear;
    const made = !!r.made || approved || !!r.rej;
    const sel = r.status === 'Selected' || OFFERED.includes(r.stage) || made;
    const reached = [true, sel, made, approved, clear, joined];
    reached.forEach((ok, i) => { if (ok) counts[i] += n; });
    const last = reached.lastIndexOf(true);
    if (last >= LEAK_STAGES.length - 1) continue;
    const reason = [
      r.status === 'Rejected' ? 'Rejected in interview' : r.status === 'No Show' ? 'No show' : r.status === 'Hold' || r.status === 'Client Round - Pending' ? 'On hold' : r.status === 'Waiting' ? 'Waiting for interview' : `Not selected (${r.status || 'open'})`,
      'Selected, no offer issued',
      r.rej ? 'Offer rejected by branch head' : 'Offer awaiting approval',
      r.bad ? 'BGV adverse / refer' : 'BGV pending',
      'Cleared, not yet joined',
    ][last];
    lose(last, reason, n);
  }
  return {
    stages: LEAK_STAGES.map((s, i) => ({ key: s.key, label: s.label, n: counts[i] })),
    losses: [...loss.values()].sort((a, b) => b.n - a.n).slice(0, 12),
  };
}

async function computeLeakage(f: PipelineFilters) {
  const raw = needsRaw(f) ? await rawValues() : undefined;
  const joinedIds = (await getJoinedInfo()).ids;
  const jsql = joinedIdSql('c.id', joinedIds);
  const w = where(f, { raw, joinedIds });
  const rows = await safe('leakage', () => q<LeakRow>(
    `SELECT c.status, c.current_stage stage, (${jsql.sql}) jn,
            COALESCE(o.made, 0) made, COALESCE(o.appr, 0) appr, COALESCE(o.rej, 0) rej, COALESCE(b.clr, 0) clr, COALESCE(b.bad, 0) bad, COUNT(*) n
     FROM ats_candidate c
     LEFT JOIN (SELECT candidate_id, MAX(status IN ('submitted','bh_approved','bh_rejected')) made, MAX(status = 'bh_approved' OR approved_at IS NOT NULL) appr,
                       MAX(status = 'bh_rejected') rej FROM ats_employment_offer GROUP BY candidate_id) o ON o.candidate_id = c.id
     LEFT JOIN (SELECT candidate_id, MAX(overall_status = 'clear') clr, MAX(overall_status IN ('adverse','refer','negative')) bad
                FROM candidate_bgv_report GROUP BY candidate_id) b ON b.candidate_id = c.id
     WHERE ${w.sql} GROUP BY c.status, c.current_stage, jn, made, appr, rej, clr, bad`, [...jsql.params, ...w.params]), []);
  const out = buildLeakage(rows.map((r) => ({ status: r.status, stage: r.stage, jn: num(r.jn), made: num(r.made), appr: num(r.appr), rej: num(r.rej), clr: num(r.clr), bad: num(r.bad), n: num(r.n) })));
  return { generatedAt: new Date().toISOString(), ...out };
}
export const getLeakage = (f: PipelineFilters) => cache.get(keyOf('leak', f), () => computeLeakage(f));

