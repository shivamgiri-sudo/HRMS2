import { createSwrCache } from './dashboard.cache.js';
import { branchFilter, canonicalSourceSql, leadSourceDisplay, reportingScope, sourceCode } from './dashboard.scope.js';
import { LEAD, getCube, isSelected, num, pct, q, readable, safe, ymd, type OverviewPeriod } from './dashboard.overview.service.js';

/**
 * Deep-dive analytics for the Command Centre and Sourcing dashboards.
 * Interview quality and salary come from ats_interview_submission (small table);
 * recruiter sourcing funnels come from ats_recruiter_hiring_activity (bulk-imported recruiter call logs).
 */

const DAYS: Record<OverviewPeriod, number | null> = { today: 1, '7d': 7, '30d': 30, '90d': 90, all: null };
const insightsCache = createSwrCache<Record<string, unknown>>({ freshMs: 120_000 });
const sourcingCache = createSwrCache<Record<string, unknown>>({ freshMs: 120_000 });

const sinceSql = (col: string, days: number | null) => (days ? `AND ${col} >= DATE_SUB(CURDATE(), INTERVAL ${days - 1} DAY)` : '');
const passRate = (sel: number, rej: number) => pct(sel, sel + rej);

export function bucketExperience(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'experience') return 'Not stated';
  if (s.includes('fresher') || s.startsWith('0-6') || s.startsWith('0-1') || s.startsWith('6-12')) return 'Fresher / <1 yr';
  if (s.startsWith('1-2') || s.startsWith('1 ')) return '1–2 yrs';
  if (s.startsWith('2-3') || s.startsWith('2+') || s.startsWith('2 ')) return '2–3 yrs';
  if (s.startsWith('3')) return '3+ yrs';
  return 'Other';
}
export function bucketEducation(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (!s) return 'Not stated';
  if (s.includes('post')) return 'Post graduate';
  if (s.includes('under')) return 'Undergraduate';
  if (s.includes('grad')) return 'Graduate';
  if (s.includes('12')) return '12th pass';
  if (s.includes('10')) return '10th pass';
  if (s.includes('diploma')) return 'Diploma';
  return 'Other';
}

async function computeInsights(period: OverviewPeriod, branch: string) {
  const days = DAYS[period];
  const bf = branch ? branchFilter(branch) : null;
  const brSql = bf ? `AND ${bf.sql}` : '';
  const brArgs = bf ? bf.params : [];
  const subFrom = `ats_interview_submission s JOIN ats_candidate c ON c.id = s.candidate_id AND ${reportingScope('c')}`;
  const subWin = sinceSql('s.submitted_at', days);

  const [cube, rounds, voc, skill, salary, speed, interviewers, profile, ages, ctc, rewalk] = await Promise.all([
    getCube(),
    safe('rounds', () => q<Record<string, string | number>>(
      `SELECT s.round1_result r1, s.skilltest_result sk, s.round2_result r2, s.round3_result r3, s.final_decision fd, COUNT(*) n
       FROM ${subFrom} WHERE 1=1 ${subWin} GROUP BY r1, sk, r2, r3, fd`), []),
    safe('voc', () => q<{ voc: string; n: number }>(
      `SELECT COALESCE(NULLIF(s.round1_voc,''),NULLIF(s.skilltest_voc,''),NULLIF(s.round2_voc,''),NULLIF(s.round3_voc,'')) AS voc, COUNT(*) AS n
       FROM ${subFrom} WHERE s.final_decision IN ('Rejected','No Show') ${subWin} GROUP BY voc ORDER BY n DESC LIMIT 12`), []),
    safe('skill', () => q<{ pr: string | null; typing: number | null; ai: number | null; n: number }>(
      `SELECT s.interviewed_for_process pr, ROUND(AVG(s.skilltest_typing),1) typing, ROUND(AVG(s.skilltest_ai),1) ai, COUNT(*) n
       FROM ${subFrom} WHERE s.skilltest_typing IS NOT NULL ${subWin} GROUP BY pr ORDER BY n DESC LIMIT 8`), []),
    safe('salary', () => q<{ pr: string | null; avg: number; mn: number; mx: number; n: number }>(
      `SELECT s.interviewed_for_process pr, ROUND(AVG(CAST(s.offer_salary AS DECIMAL(12,2)))) avg, MIN(CAST(s.offer_salary AS DECIMAL(12,2))) mn, MAX(CAST(s.offer_salary AS DECIMAL(12,2))) mx, COUNT(*) n
       FROM ${subFrom} WHERE s.offer_salary REGEXP '^[0-9]+(\\\\.[0-9]+)?$' AND CAST(s.offer_salary AS DECIMAL(12,2)) BETWEEN 5000 AND 200000 ${subWin}
       GROUP BY pr HAVING n >= 3 ORDER BY n DESC LIMIT 10`), []),
    safe('speed', () => q<{ b: string; n: number }>(
      `SELECT CASE WHEN m < 60 THEN '<1h' WHEN m < 180 THEN '1–3h' WHEN m < 1440 THEN '3–24h' WHEN m < 4320 THEN '1–3d' ELSE '3d+' END AS b, COUNT(*) n
       FROM (SELECT TIMESTAMPDIFF(MINUTE, c.created_at, s.submitted_at) m FROM ats_interview_submission s JOIN ats_candidate c ON c.id = s.candidate_id
             WHERE ${reportingScope('c')} AND s.submitted_at >= c.created_at ${subWin}) t GROUP BY b`), []),
    safe('interviewers', () => q<{ name: string; n: number; sel: number; rej: number }>(
      `SELECT COALESCE(NULLIF(s.second_round_interviewer_name_snapshot,''),'Unassigned') name, COUNT(*) n,
              SUM(s.final_decision='Selected') sel, SUM(s.final_decision='Rejected') rej
       FROM ${subFrom} WHERE s.round2_result IS NOT NULL ${subWin} GROUP BY name HAVING n >= 3 ORDER BY n DESC LIMIT 10`), []),
    // Who converts: education × experience × shift among engaged candidates
    safe('profile', () => q<{ ex: string; ed: string; ns: string; rs: number; status: string; stage: string; n: number }>(
      `SELECT experience ex, education ed, night_shift_ok ns, rotational_shift rs, status, current_stage stage, COUNT(*) n
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope('ats_candidate')} AND status <> ? ${sinceSql('created_at', days)} ${brSql}
       GROUP BY ex, ed, ns, rs, status, stage`, [LEAD, ...brArgs]), []),
    safe('ages', () => q<{ b: number; status: string; stage: string; n: number }>(
      `SELECT FLOOR(TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) / 5) * 5 AS b, status, current_stage stage, COUNT(*) n
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope('ats_candidate')} AND status <> ? AND date_of_birth IS NOT NULL ${sinceSql('created_at', days)} ${brSql}
       GROUP BY b, status, stage`, [LEAD, ...brArgs]), []),
    safe('ctc', () => q<{ b: string; n: number }>(
      `SELECT CASE WHEN o.offered_ctc < 12000 THEN '<12k' WHEN o.offered_ctc < 15000 THEN '12–15k' WHEN o.offered_ctc < 18000 THEN '15–18k' WHEN o.offered_ctc < 22000 THEN '18–22k' WHEN o.offered_ctc < 30000 THEN '22–30k' ELSE '30k+' END AS b, COUNT(*) n
       FROM ats_employment_offer o JOIN ats_candidate c ON c.id = o.candidate_id AND ${reportingScope('c')} WHERE o.offered_ctc > 0 ${sinceSql('o.created_at', days)} GROUP BY b`), []),
    safe('rewalk', () => q<{ n: number }>(`SELECT COUNT(*) n FROM ats_candidate_rewalkin r JOIN ats_candidate c ON c.id = r.candidate_id AND ${reportingScope('c')}`), []),
  ]);

  // Monthly cohort (12 months) from the shared cube — includes selection & rejection outcomes per registration month.
  const months = new Map<string, { registered: number; selected: number; rejected: number; noShow: number }>();
  const scoped = cube.filter((r) => (!branch || r.b === branch) && r.status !== LEAD);
  const from12 = ymd(Date.now() - 365 * 86_400_000).slice(0, 7);
  for (const r of scoped) {
    const m = r.d.slice(0, 7);
    if (m < from12) continue;
    const t = months.get(m) ?? { registered: 0, selected: 0, rejected: 0, noShow: 0 };
    t.registered += r.n;
    if (isSelected(r.status, r.stage)) t.selected += r.n;
    if (r.status === 'Rejected') t.rejected += r.n;
    if (r.status === 'No Show') t.noShow += r.n;
    months.set(m, t);
  }
  const monthly = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, t]) => ({ month, ...t, selRate: pct(t.selected, t.registered) }));

  // Round pass rates
  const tally = (key: 'r1' | 'sk' | 'r2' | 'r3') => {
    let sel = 0, rej = 0, ns = 0;
    for (const r of rounds) {
      const v = String(r[key] ?? '');
      const n = num(r.n);
      if (v === 'Selected' || v === 'Cleared') sel += n; else if (v === 'Rejected') rej += n; else if (v === 'No Show') ns += n;
    }
    return { sel, rej, noShow: ns, passRate: passRate(sel, rej) };
  };
  const roundStats = [
    { round: 'HR screening', ...tally('r1') }, { round: 'Skill test', ...tally('sk') },
    { round: "Ops round", ...tally('r2') }, { round: 'Client round', ...tally('r3') },
  ];

  // Profile breakdowns: volume + selection rate
  const group = <K extends string>(rows: typeof profile, keyOf: (r: (typeof profile)[number]) => K) => {
    const m = new Map<K, { total: number; selected: number }>();
    for (const r of rows) {
      const k = keyOf(r), t = m.get(k) ?? { total: 0, selected: 0 };
      t.total += num(r.n);
      if (isSelected(r.status, r.stage)) t.selected += num(r.n);
      m.set(k, t);
    }
    return [...m.entries()].map(([name, t]) => ({ name, ...t, selRate: pct(t.selected, t.total) })).sort((a, b) => b.total - a.total);
  };
  const shiftLabel = (r: (typeof profile)[number]) => (r.ns === 'Yes' ? 'Night OK' : r.ns === 'Conditional' ? 'Conditional' : r.ns === 'No' ? 'No nights' : 'Not stated');

  const ageMap = new Map<number, { total: number; selected: number }>();
  for (const r of ages) {
    const t = ageMap.get(num(r.b)) ?? { total: 0, selected: 0 };
    t.total += num(r.n);
    if (isSelected(r.status, r.stage)) t.selected += num(r.n);
    ageMap.set(num(r.b), t);
  }
  const ageBands = [...ageMap.entries()].filter(([b]) => b >= 15 && b <= 55).sort(([a], [b]) => a - b)
    .map(([b, t]) => ({ name: `${b}–${b + 4}`, ...t, selRate: pct(t.selected, t.total) }));

  const vocTotal = voc.reduce((a, r) => a + num(r.n), 0);
  return {
    generatedAt: new Date().toISOString(), period, branch: branch || null,
    monthly,
    rounds: roundStats,
    rejectionReasons: voc.filter((r) => r.voc).map((r) => ({ reason: r.voc, n: num(r.n), share: pct(num(r.n), vocTotal) })),
    skill: skill.map((r) => ({ process: readable(r.pr), typing: num(r.typing), ai: num(r.ai), n: num(r.n) })),
    salary: salary.map((r) => ({ process: readable(r.pr), avg: num(r.avg), min: num(r.mn), max: num(r.mx), n: num(r.n) })),
    ctcBands: ['<12k', '12–15k', '15–18k', '18–22k', '22–30k', '30k+'].map((b) => ({ band: b, n: num(ctc.find((c) => c.b === b)?.n) })),
    decisionSpeed: ['<1h', '1–3h', '3–24h', '1–3d', '3d+'].map((b) => ({ bucket: b, n: num(speed.find((c) => c.b === b)?.n) })),
    interviewers: interviewers.map((r) => ({ name: r.name, interviews: num(r.n), selected: num(r.sel), rejected: num(r.rej), passRate: passRate(num(r.sel), num(r.rej)) })),
    experience: group(profile, (r) => bucketExperience(r.ex)),
    education: group(profile, (r) => bucketEducation(r.ed)),
    shift: group(profile, shiftLabel),
    ageBands,
    rewalkins: num(rewalk[0]?.n),
  };
}

export const getAtsInsights = (period: OverviewPeriod = '90d', branch = '') =>
  insightsCache.get(`${period}|${branch}`, () => computeInsights(period, branch));

/* ───────────────────────── Sourcing (recruiter call-log funnel) ───────────────────────── */

async function computeSourcing(period: OverviewPeriod) {
  const days = DAYS[period];
  const win = sinceSql('activity_date', days);
  const [bySource, monthly, byRecruiter, reasons, referrals, dup] = await Promise.all([
    safe('bySource', () => q<Record<string, number | string>>(
      `SELECT hiring_source src, COUNT(*) sourced, SUM(contacted_flag=1) contacted, SUM(walkin_flag=1) walkin,
              SUM(final_selection_flag=1) selected, SUM(joined_flag=1) joined
       FROM ats_recruiter_hiring_activity WHERE 1=1 ${win} GROUP BY src`), []),
    safe('monthly', () => q<Record<string, number | string>>(
      `SELECT DATE_FORMAT(activity_date,'%Y-%m') m, hiring_source src, COUNT(*) sourced, SUM(walkin_flag=1) walkin, SUM(final_selection_flag=1) selected, SUM(joined_flag=1) joined
       FROM ats_recruiter_hiring_activity WHERE activity_date IS NOT NULL ${win} GROUP BY m, src`), []),
    safe('byRecruiter', () => q<Record<string, number | string>>(
      `SELECT COALESCE(NULLIF(recruiter_name_snapshot,''),'Unassigned') rc, COUNT(*) sourced, SUM(contacted_flag=1) contacted, SUM(walkin_flag=1) walkin,
              SUM(final_selection_flag=1) selected, SUM(joined_flag=1) joined
       FROM ats_recruiter_hiring_activity WHERE 1=1 ${win} GROUP BY rc HAVING sourced >= 5 AND rc NOT IN ('Unknown','Unassigned') ORDER BY sourced DESC LIMIT 15`), []),
    safe('reasons', () => q<{ r: string; n: number }>(
      `SELECT COALESCE(NULLIF(hr_rejection_reason,''),NULLIF(recruiter_rejection_reason,''),NULLIF(ops_rejection_reason,'')) r, COUNT(*) n
       FROM ats_recruiter_hiring_activity WHERE 1=1 ${win} GROUP BY r HAVING r IS NOT NULL ORDER BY n DESC LIMIT 8`), []),
    safe('referrals', () => q<{ name: string; n: number; joined: number }>(
      `SELECT COALESCE(NULLIF(referee_name,''),'Unknown') name, COUNT(*) n, SUM(joined_flag=1) joined
       FROM ats_recruiter_hiring_activity WHERE referee_name IS NOT NULL AND referee_name <> '' ${win} GROUP BY name ORDER BY n DESC LIMIT 8`), []),
    safe('dup', () => q<{ n: number }>(`SELECT COUNT(*) n FROM ats_recruiter_hiring_activity WHERE duplicate_warning IS NOT NULL AND duplicate_warning <> '' ${win}`), []),
  ]);

  const merge = new Map<string, { sourced: number; contacted: number; walkin: number; selected: number; joined: number }>();
  for (const r of bySource) {
    const k = leadSourceDisplay(r.src), t = merge.get(k) ?? { sourced: 0, contacted: 0, walkin: 0, selected: 0, joined: 0 };
    t.sourced += num(r.sourced); t.contacted += num(r.contacted); t.walkin += num(r.walkin); t.selected += num(r.selected); t.joined += num(r.joined);
    merge.set(k, t);
  }
  const sources = [...merge.entries()].map(([name, t]) => ({
    name, ...t,
    contactRate: pct(t.contacted, t.sourced), walkinRate: pct(t.walkin, t.sourced),
    yieldRate: pct(t.selected, t.sourced), joinRate: pct(t.joined, t.selected),
  })).sort((a, b) => b.sourced - a.sourced);

  const trend = new Map<string, Record<string, number | string>>();
  for (const r of monthly) {
    const m = String(r.m), src = leadSourceDisplay(r.src);
    if (src === 'Walk-in') continue; // bulk historical import: would dwarf the live sources
    const row = trend.get(m) ?? { month: m };
    row[src] = num(row[src]) + num(r.sourced);
    trend.set(m, row);
  }

  // The 'Walk-in' source is a bulk historical import with no recruiter attribution; keep it out of the sourcing funnel.
  const legacy = sources.find((s) => s.name === 'Walk-in') ?? null;
  const total = sources.filter((s) => s.name !== 'Walk-in').reduce((a, s) => ({ sourced: a.sourced + s.sourced, contacted: a.contacted + s.contacted, walkin: a.walkin + s.walkin, selected: a.selected + s.selected, joined: a.joined + s.joined }), { sourced: 0, contacted: 0, walkin: 0, selected: 0, joined: 0 });
  return {
    generatedAt: new Date().toISOString(), period,
    totals: total,
    legacyWalkin: legacy,
    funnel: [
      { stage: 'Sourced', n: total.sourced }, { stage: 'Contacted', n: total.contacted }, { stage: 'Walked in', n: total.walkin },
      { stage: 'Selected', n: total.selected }, { stage: 'Joined', n: total.joined },
    ],
    sources,
    seriesNames: sources.filter((s) => s.name !== 'Walk-in').slice(0, 5).map((s) => s.name),
    trend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v),
    recruiters: byRecruiter.map((r) => ({
      name: String(r.rc), sourced: num(r.sourced), contacted: num(r.contacted), walkin: num(r.walkin), selected: num(r.selected), joined: num(r.joined),
      contactRate: pct(num(r.contacted), num(r.sourced)), walkinRate: pct(num(r.walkin), num(r.sourced)),
    })),
    rejectionReasons: reasons.map((r) => ({ reason: r.r, n: num(r.n) })),
    referrers: referrals.map((r) => ({ name: r.name, referred: num(r.n), joined: num(r.joined) })),
    duplicateWarnings: num(dup[0]?.n),
  };
}

export const getSourcingInsights = (period: OverviewPeriod = 'all') => sourcingCache.get(period, () => computeSourcing(period));

export function warmInsights() {
  const run = async () => {
    for (const p of ['90d', 'all'] as OverviewPeriod[]) {
      await insightsCache.refresh(`${p}|`, () => computeInsights(p, '')).catch((e) => console.error('[ats-insights] warm failed:', (e as Error).message));
      await sourcingCache.refresh(p, () => computeSourcing(p)).catch((e) => console.error('[ats-sourcing] warm failed:', (e as Error).message));
    }
  };
  void run();
  setInterval(() => void run(), 10 * 60_000).unref();
}

/* ───────────── Sourcing leads drill (recruiter call-log records) ───────────── */
export interface LeadFilters { notSource?: string; source?: string; recruiter?: string; stage?: string; month?: string; reason?: string; page: number; limit: number; scope?: { sql: string; params: unknown[] } }
const leadsCache = createSwrCache<Record<string, unknown>>({ freshMs: 60_000 });
const leadSourceSql = canonicalSourceSql('hiring_source');

async function computeLeads(f: LeadFilters) {
  const c = ['1=1'], p: unknown[] = [];
  if (f.scope?.sql) { c.push(`(${f.scope.sql})`); p.push(...f.scope.params); }
  if (f.source) { if (f.source === 'Unspecified') c.push("(hiring_source IS NULL OR hiring_source = '')"); else { c.push(`${leadSourceSql} = ?`); p.push(sourceCode(f.source)); } }
  if (f.notSource) { c.push(`(hiring_source IS NULL OR ${leadSourceSql} <> ?)`); p.push(sourceCode(f.notSource)); }
  if (f.recruiter) { c.push('recruiter_name_snapshot = ?'); p.push(f.recruiter); }
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) { c.push("DATE_FORMAT(activity_date,'%Y-%m') = ?"); p.push(f.month); }
  if (f.reason) { c.push("COALESCE(NULLIF(hr_rejection_reason,''),NULLIF(recruiter_rejection_reason,''),NULLIF(ops_rejection_reason,'')) = ?"); p.push(f.reason); }
  const flag: Record<string, string> = { contacted: 'contacted_flag = 1', walkin: 'walkin_flag = 1', selected: 'final_selection_flag = 1', joined: 'joined_flag = 1' };
  if (f.stage && flag[f.stage]) c.push(flag[f.stage]);
  const limit = Math.min(Math.max(f.limit, 1), 100), offset = (Math.max(f.page, 1) - 1) * limit, where = c.join(' AND ');
  const [rows, total, statuses] = await Promise.all([
    q(`SELECT candidate_name name, mobile, hiring_source source, COALESCE(NULLIF(recruiter_name_snapshot,''),'Unassigned') recruiter, current_status status,
              joining_status joining, activity_date at, branch_name branch, process_name process, position_name position
       FROM ats_recruiter_hiring_activity WHERE ${where} ORDER BY activity_date DESC LIMIT ${limit} OFFSET ${offset}`, p),
    q<{ n: number }>(`SELECT COUNT(*) n FROM ats_recruiter_hiring_activity WHERE ${where}`, p),
    q<{ s: string | null; n: number }>(`SELECT current_status s, COUNT(*) n FROM ats_recruiter_hiring_activity WHERE ${where} GROUP BY s ORDER BY n DESC LIMIT 8`, p),
  ]);
  return { rows, total: num(total[0]?.n), page: f.page, limit, statuses: statuses.map((r) => ({ name: r.s || 'No status', n: num(r.n) })) };
}
export const getSourcingLeads = (f: LeadFilters) => leadsCache.get(JSON.stringify(f), () => computeLeads(f));
