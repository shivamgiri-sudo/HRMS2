import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { createSwrCache } from './dashboard.cache.js';
import { BRANCH_EXPR, JOINED, LEAD, OFFERED, num, pct, q, safe } from './dashboard.overview.service.js';
import { getJoinedInfo, joinedIdSql } from './dashboard.joined.js';
import { branchDisplay, branchFilter, canonicalSourceSql, recruiterNameSql, recruiterLabelSql, sourceValueSql, legacyImportSql, refreshImportTag, processDisplay, rawValues, recruiterNamer, reportingScope, sourceCode, sourceDisplay } from './dashboard.scope.js';
import { bucketEducation, bucketExperience } from './dashboard.insights.service.js';

/** Slim, server-paged candidate list + drilldown for the ATS pipeline dashboard. Never SELECT * on this table. */

export interface PipelineFilters {
  from?: string;
  to?: string;
  branch?: string;
  process?: string;
  status?: string;
  stage?: string;
  search?: string;
  includeLeads?: boolean;
  page: number;
  limit: number;
  source?: string;
  recruiter?: string;
  outcome?: string;
  gender?: string;
  idle?: string;
  hour?: number;
  dow?: number;
  experience?: string;
  education?: string;
  shift?: string;
  age?: string;
  voc?: string;
  interviewer?: string;
  scope?: { sql: string; params: unknown[] };
}

const HOLD = ['Hold', 'Client Round - Pending'];
export const OPEN_STATUSES = ['Waiting', 'Hold', 'Client Round - Pending', 'profile_submitted', 'hr_approved', 'Pending', 'active', 'hr_pushback'];
const IDLE: Record<string, [number, number]> = { '0-1d': [0, 1], '2-3d': [2, 3], '4-7d': [4, 7], '8-14d': [8, 14], '15d+': [15, 100000] };
const inSql = (xs: string[]) => xs.map(() => '?').join(',');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cache = createSwrCache<Record<string, unknown>>({
  freshMs: 30_000,
  staleMs: 5 * 60_000,
});

export function where(f: PipelineFilters, opts: { skipStatus?: boolean; raw?: Awaited<ReturnType<typeof rawValues>>; joinedIds?: readonly string[] } = {}) {
  const c = ['c.active_status = 1', reportingScope('c')];
  const p: unknown[] = [];
  if (!f.includeLeads) {
    c.push("c.status <> ?");
    p.push(LEAD);
  }
  if (f.from && DATE_RE.test(f.from)) {
    c.push("c.created_at >= ?");
    p.push(f.from);
  }
  if (f.to && DATE_RE.test(f.to)) {
    c.push("c.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    p.push(f.to);
  }
  if (f.branch) {
    const bf = branchFilter(f.branch, "c");
    c.push(bf.sql);
    p.push(...bf.params);
  }
  if (f.process && opts.raw) {
    const vals = opts.raw.process.filter(
      (v) => processDisplay(v) === f.process,
    );
    if (f.process === "Unspecified")
      c.push("(c.applied_for_process IS NULL OR c.applied_for_process = '')");
    else if (vals.length) {
      c.push(`c.applied_for_process IN (${inSql(vals)})`);
      p.push(...vals);
    } else c.push("1=0");
  }
  if (!opts.skipStatus) {
    if (f.status) {
      c.push("c.status = ?");
      p.push(f.status);
    }
    if (f.stage) {
      c.push("c.current_stage = ?");
      p.push(f.stage);
    }
  }
  if (f.search && f.search.trim()) {
    const s = `%${f.search.trim().slice(0, 60)}%`;
    c.push(
      "(c.full_name LIKE ? OR c.mobile LIKE ? OR c.candidate_code LIKE ? OR c.q_token LIKE ?)",
    );
    p.push(s, s, s, s);
  }
  if (f.source) { c.push(`${canonicalSourceSql(sourceValueSql('c'))} = ?`); p.push(sourceCode(f.source)); }
  if (f.recruiter && opts.raw) {
    if (f.recruiter === 'Unassigned') c.push(`${recruiterNameSql('c')} IS NULL AND NOT ${legacyImportSql('c')}`);
    else if (f.recruiter === 'Legacy import') c.push(`${recruiterNameSql('c')} IS NULL AND ${legacyImportSql('c')}`);
    else {
      const namer = recruiterNamer(opts.raw.recruiter);
      const vals = opts.raw.recruiter.filter((v) => namer(v) === f.recruiter);
      if (vals.length) { c.push(`${recruiterNameSql('c')} IN (${inSql(vals)})`); p.push(...vals); } else c.push('1=0');
    }
  }
  if (f.outcome) {
    switch (f.outcome) {
      case "selected":
        c.push(
          `(c.status = 'Selected' OR c.current_stage IN (${inSql(OFFERED)}))`,
        );
        p.push(...OFFERED);
        break;
      case "rejected":
        c.push("c.status = 'Rejected'");
        break;
      case "noShow":
        c.push("c.status = 'No Show'");
        break;
      case "hold":
        c.push(`c.status IN (${inSql(HOLD)})`);
        p.push(...HOLD);
        break;
      case "waiting":
        c.push("c.status = 'Waiting'");
        break;
      case "joined": {
        const j = joinedIdSql("c.id", opts.joinedIds ?? []);
        c.push(j.sql);
        p.push(...j.params);
        break;
      }
      case "offered":
        c.push(`c.current_stage IN (${inSql(OFFERED)})`);
        p.push(...OFFERED);
        break;
    }
  }
  if (f.idle && IDLE[f.idle]) {
    const [lo, hi] = IDLE[f.idle];
    c.push(
      `c.status IN (${inSql(OPEN_STATUSES)}) AND DATEDIFF(NOW(), c.updated_at) BETWEEN ? AND ?`,
    );
    p.push(...OPEN_STATUSES, lo, hi);
  }
  if (f.hour != null && Number.isInteger(f.hour)) {
    c.push("HOUR(c.created_at) = ?");
    p.push(f.hour);
  }
  if (f.dow != null && Number.isInteger(f.dow)) {
    c.push("DAYOFWEEK(c.created_at) = ?");
    p.push(f.dow);
  }
  for (const key of ["experience", "education"] as const) {
    const bucket = f[key];
    if (!bucket || !opts.raw) continue;
    const fn = key === "experience" ? bucketExperience : bucketEducation;
    const vals = opts.raw[key].filter((v) => fn(v) === bucket);
    if (bucket === "Not stated") {
      c.push(
        `(c.${key} IS NULL OR c.${key} = ''${vals.length ? ` OR c.${key} IN (${inSql(vals)})` : ""})`,
      );
      p.push(...vals);
    } else if (vals.length) {
      c.push(`c.${key} IN (${inSql(vals)})`);
      p.push(...vals);
    } else c.push("1=0");
  }
  if (f.shift) {
    const m: Record<string, string> = {
      "Night OK": "c.night_shift_ok = 'Yes'",
      Conditional: "c.night_shift_ok = 'Conditional'",
      "No nights": "c.night_shift_ok = 'No'",
      "Not stated": "(c.night_shift_ok IS NULL OR c.night_shift_ok = '')",
    };
    if (m[f.shift]) c.push(m[f.shift]);
  }
  if (f.age && /^\d{2}$/.test(f.age.slice(0, 2))) {
    const lo = Number(f.age.slice(0, 2));
    c.push(
      "c.date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, c.date_of_birth, CURDATE()) BETWEEN ? AND ?",
    );
    p.push(lo, lo + 4);
  }
  if (f.voc) {
    c.push(`EXISTS (SELECT 1 FROM ats_interview_submission s WHERE s.candidate_id = c.id AND s.final_decision IN ('Rejected','No Show')
      AND COALESCE(NULLIF(s.round1_voc,''),NULLIF(s.skilltest_voc,''),NULLIF(s.round2_voc,''),NULLIF(s.round3_voc,'')) = ?)`);
    p.push(f.voc);
  }
  if (f.interviewer) {
    c.push(
      "EXISTS (SELECT 1 FROM ats_interview_submission s WHERE s.candidate_id = c.id AND s.second_round_interviewer_name_snapshot = ?)",
    );
    p.push(f.interviewer);
  }
  const scopeSql = f.scope?.sql
    ? String(f.scope.sql)
        .replace(/^WHERE\s+/i, "")
        .trim()
    : "";
  if (scopeSql) {
    c.push(`(${scopeSql})`);
    p.push(...(f.scope?.params ?? []));
  }
  return { sql: c.join(" AND "), params: p };
}

async function compute(f: PipelineFilters) {
  await refreshImportTag();
  const raw = f.experience || f.education || f.process || f.recruiter ? await rawValues() : undefined;
  const joinedIds = f.outcome === 'joined' ? (await getJoinedInfo()).ids : undefined;
  const w = where(f, { raw, joinedIds }), wf = where(f, { skipStatus: true, raw, joinedIds });
  const limit = Math.min(Math.max(f.limit, 1), 100), offset = (Math.max(f.page, 1) - 1) * limit;
  const [rows, total, facets] = await Promise.all([
    q<RowDataPacket>(
      `SELECT c.id, c.candidate_code, c.q_token, c.full_name, c.mobile, c.email, c.status, c.current_stage AS stage,
              ${BRANCH_EXPR.replace(/\b(branch_display_name|applied_for_branch)\b/g, 'c.$1')} AS branch, c.applied_for_process AS process,
              ${sourceValueSql('c')} AS source, ${recruiterLabelSql('c')} AS recruiter, c.experience, c.education, c.created_at, c.updated_at
       FROM ats_candidate c WHERE ${w.sql} ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${offset}`, w.params),
    q<{ n: number }>(`SELECT COUNT(*) n FROM ats_candidate c WHERE ${w.sql}`, w.params),
    safe('facets', () => q<{ status: string; stage: string; n: number }>(
      `SELECT c.status, c.current_stage AS stage, COUNT(*) n FROM ats_candidate c WHERE ${wf.sql} GROUP BY c.status, c.current_stage`, wf.params), []),
  ]);
  const byStatus = new Map<string, number>(),
    byStage = new Map<string, number>();
  for (const r of facets) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + num(r.n));
    byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + num(r.n));
  }
  const toList = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n);
  const namer = recruiterNamer(rows.map((r) => r.recruiter as string));
  const shaped = rows.map((r) => ({
    ...r,
    branch: branchDisplay(r.branch),
    process: r.process ? processDisplay(r.process) : null,
    source: sourceDisplay(r.source),
    recruiter: r.recruiter ? namer(r.recruiter) : null,
  }));
  return {
    rows: shaped,
    total: num(total[0]?.n),
    page: f.page,
    limit,
    statuses: toList(byStatus),
    stages: toList(byStage),
  };
}

export const listPipeline = (f: PipelineFilters) =>
  cache.get(
    JSON.stringify({ ...f, scope: f.scope?.params }) + (f.scope?.sql ?? ""),
    () => compute(f),
  );

/* ───────────── Drill: trend + splits for any slice ───────────── */
const drillCache = createSwrCache<Record<string, unknown>>({
  freshMs: 60_000,
  staleMs: 10 * 60_000,
});

interface DrillRow {
  d: string;
  branch: string;
  process: string | null;
  source: string | null;
  recruiter: string | null;
  status: string;
  stage: string;
  dow: number;
  jn: number;
  n: number;
}

async function computeDrill(f: PipelineFilters) {
  await refreshImportTag();
  const raw = f.experience || f.education || f.process || f.recruiter ? await rawValues() : undefined;
  const joinedIds = (await getJoinedInfo()).ids;
  const jsql = joinedIdSql("c.id", joinedIds);
  const w = where(f, { raw, joinedIds });
  const rows = await q<DrillRow>(
    `SELECT DATE_FORMAT(c.created_at,'%Y-%m-%d') d, ${BRANCH_EXPR.replace(/\b(branch_display_name|applied_for_branch)\b/g, 'c.$1')} branch, c.applied_for_process process,
            ${sourceValueSql('c')} source, ${recruiterLabelSql('c')} recruiter, c.status, c.current_stage stage, DAYOFWEEK(c.created_at) dow, (${jsql.sql}) jn, COUNT(*) n
     FROM ats_candidate c WHERE ${w.sql} GROUP BY d, branch, process, source, recruiter, status, stage, dow, jn`, [...jsql.params, ...w.params]);

  const drillNamer = recruiterNamer(rows.map((r) => r.recruiter ?? ""));
  const selected = (r: DrillRow) =>
    r.status === "Selected" || OFFERED.includes(r.stage);
  const t = {
    total: 0,
    selected: 0,
    rejected: 0,
    noShow: 0,
    hold: 0,
    waiting: 0,
    joined: 0,
  };
  const day = new Map<
    string,
    { total: number; selected: number; rejected: number }
  >();
  const dow = new Map<number, { total: number; selected: number }>();
  type Split = { total: number; selected: number; rejected: number; noShow: number; hold: number; waiting: number; joined: number };
  const dims: Record<string, Map<string, Split>> = { branch: new Map(), process: new Map(), source: new Map(), recruiter: new Map(), stage: new Map(), status: new Map() };
  const bump = (m: Map<string, Split>, k: string, r: DrillRow) => {
    const x = m.get(k) ?? { total: 0, selected: 0, rejected: 0, noShow: 0, hold: 0, waiting: 0, joined: 0 };
    const n = num(r.n);
    x.total += n; if (selected(r)) x.selected += n; if (r.status === 'Rejected') x.rejected += n;
    if (r.status === 'No Show') x.noShow += n; if (HOLD.includes(r.status)) x.hold += n; if (r.status === 'Waiting') x.waiting += n;
    if (r.jn || JOINED.includes(r.stage)) x.joined += n;
    m.set(k, x);
  };
  for (const r of rows) {
    const n = num(r.n);
    t.total += n;
    if (selected(r)) t.selected += n;
    if (r.status === "Rejected") t.rejected += n;
    if (r.status === "No Show") t.noShow += n;
    if (HOLD.includes(r.status)) t.hold += n;
    if (r.status === "Waiting") t.waiting += n;
    if (r.jn || JOINED.includes(r.stage)) t.joined += n;
    const dd = day.get(r.d) ?? { total: 0, selected: 0, rejected: 0 };
    dd.total += n;
    if (selected(r)) dd.selected += n;
    if (r.status === "Rejected") dd.rejected += n;
    day.set(r.d, dd);
    const dw = dow.get(num(r.dow)) ?? { total: 0, selected: 0 };
    dw.total += n;
    if (selected(r)) dw.selected += n;
    dow.set(num(r.dow), dw);
    bump(dims.branch, branchDisplay(r.branch), r);
    bump(dims.process, processDisplay(r.process), r);
    bump(dims.source, sourceDisplay(r.source), r);
    bump(dims.recruiter, drillNamer(r.recruiter), r);
    bump(dims.stage, r.stage, r);
    bump(dims.status, r.status, r);
  }
  const top = (m: Map<string, Split>) =>
    [...m.entries()].map(([name, x]) => ({
      name, ...x, selRate: pct(x.selected, x.total), rejRate: pct(x.rejected, x.total), noShowRate: pct(x.noShow, x.total), joinRate: pct(x.joined, x.selected),
    })).sort((a, b) => b.total - a.total).slice(0, 25);
  const hourDow = await safe('hourDow', () => q<{ dow: number; hour: number; total: number; selected: number }>(
    `SELECT DAYOFWEEK(c.created_at) dow, HOUR(c.created_at) hour, COUNT(*) total,
            SUM(c.status = 'Selected' OR c.current_stage IN (${inSql(OFFERED)})) selected
     FROM ats_candidate c WHERE ${w.sql} GROUP BY dow, hour`, [...OFFERED, ...w.params]), []);
  const days = [...day.entries()].sort(([a], [b]) => a.localeCompare(b));
  // Long slices are shown by week so the chart stays readable.
  const bucketed =
    days.length > 75 ? weekly(days) : days.map(([date, x]) => ({ date, ...x }));
  return {
    total: t.total, kpis: { ...t, selRate: pct(t.selected, t.total), rejRate: pct(t.rejected, t.total), noShowRate: pct(t.noShow, t.total), joinRate: pct(t.joined, t.selected) },
    trend: bucketed, weekly: days.length > 75,
    weekday: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dow: d, total: dow.get(d)?.total ?? 0, selRate: pct(dow.get(d)?.selected ?? 0, dow.get(d)?.total ?? 0) })),
    splits: Object.fromEntries(Object.entries(dims).map(([k, m]) => [k, top(m)])),
    hourDow: hourDow.map((r) => ({ dow: num(r.dow), hour: num(r.hour), total: num(r.total), selected: num(r.selected) })),
  };
}

function weekly(
  days: [string, { total: number; selected: number; rejected: number }][],
) {
  const m = new Map<
    string,
    { total: number; selected: number; rejected: number }
  >();
  for (const [d, x] of days) {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    const k = dt.toISOString().slice(0, 10),
      y = m.get(k) ?? { total: 0, selected: 0, rejected: 0 };
    y.total += x.total;
    y.selected += x.selected;
    y.rejected += x.rejected;
    m.set(k, y);
  }
  return [...m.entries()].map(([date, x]) => ({ date, ...x }));
}

export const getDrill = (f: PipelineFilters) =>
  drillCache.get(
    JSON.stringify({ ...f, scope: f.scope?.params }) + (f.scope?.sql ?? ""),
    () => computeDrill(f),
  );

/** Everything the drilldown drawer needs, in one round trip. */
export async function getCandidateJourney(id: string) {
  await refreshImportTag();
  const one = async <T = RowDataPacket>(sql: string) => (await safe('journey', () => q<T>(sql, [id]), []))[0] ?? null;
  const [cand, logs, sub, offer, bgv, token] = await Promise.all([
    one(`SELECT id, candidate_code, q_token, full_name, mobile, email, gender, status, current_stage AS stage, applied_for_process AS process,
                ${BRANCH_EXPR} AS branch, ${sourceValueSql()} AS source, ${recruiterLabelSql()} AS recruiter, experience, education, created_at, updated_at
         FROM ats_candidate WHERE id = ?`),
    safe(
      "logs",
      () =>
        q<RowDataPacket>(
          `SELECT from_stage, to_stage, COALESCE(stage_date, created_at) AS at, remarks FROM ats_candidate_stage_log WHERE candidate_id = ? ORDER BY COALESCE(stage_date, created_at) ASC LIMIT 60`,
          [id],
        ),
      [],
    ),
    one(`SELECT final_decision, walkin_end_stage, round1_result, round1_voc, skilltest_result, skilltest_typing, skilltest_ai, skilltest_voc, round2_result, round2_voc,
                round3_result, round3_voc, offer_salary, offer_doj, second_round_interviewer_name_snapshot AS interviewer, submitted_at
         FROM ats_interview_submission WHERE candidate_id = ? ORDER BY submitted_at DESC LIMIT 1`),
    one(
      `SELECT status, offered_ctc, gross, date_of_joining, approved_at FROM ats_employment_offer WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    ),
    one(
      `SELECT overall_status, bgv_score, completed_at FROM candidate_bgv_report WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    ),
    one(
      `SELECT token_number, status, arrival_time, interview_started_at, interview_completed_at FROM ats_queue_token WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    ),
  ]);
  return {
    candidate: cand,
    stageLogs: logs,
    submission: sub,
    offer,
    bgv,
    queueToken: token,
  };
}

export { db };
