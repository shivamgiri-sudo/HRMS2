import { createSwrCache } from './dashboard.cache.js';
import { BRANCH_EXPR, LEAD, num, q, safe } from './dashboard.overview.service.js';
import { branchDisplay, recruiterNamer, recruiterNameSql, reportingScope } from './dashboard.scope.js';

/** Live operations view: today's queue, SLA history, recruiter capacity and recoverable candidates. */

const SLA_MINUTES = 120;
const OPEN = ['Waiting', 'Hold', 'Client Round - Pending', 'Pending'];
const ph = (xs: string[]) => xs.map(() => '?').join(',');
const cache = createSwrCache<Record<string, unknown>>({ freshMs: 20_000, staleMs: 5 * 60_000 });

async function compute() {
  const [today, queue, hourly, branches, roster, slaDaily, slaRecent, recoverable, recoverList] = await Promise.all([
    safe('today', () => q<Record<string, number>>(
      `SELECT COUNT(*) arrived, SUM(status='Selected') selected, SUM(status='Rejected') rejected, SUM(status='No Show') no_show,
              SUM(status IN (${ph(OPEN)})) waiting
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope('ats_candidate')} AND status <> ? AND created_at >= CURDATE()`, [...OPEN, LEAD]), []),
    safe('queue', () => q<Record<string, string | number | null>>(
      `SELECT c.id, c.candidate_code code, c.full_name name, c.status, c.current_stage stage, c.applied_for_process process,
              ${BRANCH_EXPR.replace(/\b(branch_display_name|applied_for_branch)\b/g, 'c.$1')} branch, COALESCE(${recruiterNameSql('c')},'Unassigned') recruiter,
              c.created_at arrival, TIMESTAMPDIFF(MINUTE, c.created_at, NOW()) wait_min,
              (SELECT t.token_number FROM ats_queue_token t WHERE t.candidate_id = c.id ORDER BY t.created_at DESC LIMIT 1) token
       FROM ats_candidate c WHERE c.active_status = 1 AND ${reportingScope('c')} AND c.created_at >= CURDATE() AND c.status IN (${ph(OPEN)})
       ORDER BY c.created_at ASC LIMIT 60`, OPEN), []),
    safe('hourly', () => q<{ d: number; h: number; n: number }>(
      `SELECT (DATE(created_at) = CURDATE()) d, HOUR(created_at) h, COUNT(*) n
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope('ats_candidate')} AND status <> ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) GROUP BY d, h`, [LEAD]), []),
    safe('branches', () => q<Record<string, string | number>>(
      `SELECT ${BRANCH_EXPR} name, COUNT(*) arrived, SUM(status IN (${ph(OPEN)})) waiting,
              SUM(status IN (${ph(OPEN)}) AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) > ${SLA_MINUTES}) breach, SUM(status='Selected') selected
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope('ats_candidate')} AND status <> ? AND created_at >= CURDATE() GROUP BY name ORDER BY arrived DESC LIMIT 12`, [...OPEN, ...OPEN, LEAD]), []),
    safe('roster', () => q<Record<string, string | number>>(
      `SELECT name, branch, COALESCE(daily_capacity,0) capacity, COALESCE(assigned_today,0) assigned, COALESCE(available_today,0) available
       FROM ats_recruiter_roster WHERE COALESCE(active_flag, active_status, 1) = 1 ORDER BY assigned_today DESC LIMIT 20`), []),
    safe('slaDaily', () => q<{ d: string; n: number; avg: number }>(
      `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') d, COUNT(*) n, ROUND(AVG(breach_minutes)) avg
       FROM ats_command_sla_event WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY d ORDER BY d`), []),
    safe('slaRecent', () => q<Record<string, string | number>>(
      `SELECT q_token token, breach_minutes minutes, threshold_minutes threshold, event_status status, created_at at
       FROM ats_command_sla_event ORDER BY created_at DESC LIMIT 8`), []),
    safe('recoverable', () => q<{ no_show: number; hold: number }>(
      `SELECT SUM(status='No Show') no_show, SUM(status IN ('Hold','Client Round - Pending')) hold
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope('ats_candidate')} AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`), []),
    safe('recoverList', () => q<Record<string, string | number>>(
      `SELECT id, full_name name, mobile, status, current_stage stage, applied_for_process process, created_at at
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope('ats_candidate')} AND created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND status IN ('No Show','Hold','Client Round - Pending')
       ORDER BY created_at DESC LIMIT 12`), []),
  ]);

  const rcName = recruiterNamer(queue.map((r) => String(r.recruiter ?? '')));
  const t = today[0] ?? {};
  const waits = queue.map((r) => num(r.wait_min));
  const bucket = (lo: number, hi: number) => waits.filter((w) => w >= lo && w < hi).length;
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h, today: num(hourly.find((r) => num(r.d) === 1 && num(r.h) === h)?.n), yesterday: num(hourly.find((r) => num(r.d) === 0 && num(r.h) === h)?.n),
  })).filter((r) => r.hour >= 7 && r.hour <= 21);
  const rec = recoverable[0] ?? {};

  return {
    generatedAt: new Date().toISOString(), slaMinutes: SLA_MINUTES,
    today: { arrived: num(t.arrived), selected: num(t.selected), rejected: num(t.rejected), noShow: num(t.no_show), waiting: num(t.waiting), breach: waits.filter((w) => w > SLA_MINUTES).length },
    queue: queue.map((r) => ({ id: r.id, code: r.code, name: r.name, status: r.status, stage: r.stage, process: r.process, branch: branchDisplay(r.branch), recruiter: rcName(r.recruiter), arrival: r.arrival, waitMin: num(r.wait_min), token: r.token })),
    waitBuckets: [{ label: '<30m', n: bucket(0, 30) }, { label: '30–60m', n: bucket(30, 60) }, { label: '1–2h', n: bucket(60, SLA_MINUTES) }, { label: '2h+', n: bucket(SLA_MINUTES, Infinity) }],
    hourly: hours,
    branches: mergeBranches(branches),
    roster: roster.map((r) => ({ name: r.name, branch: r.branch, capacity: num(r.capacity), assigned: num(r.assigned), available: num(r.available) === 1 })),
    sla: { daily: slaDaily.map((r) => ({ date: r.d, events: num(r.n), avgBreach: num(r.avg) })), recent: slaRecent.map((r) => ({ token: r.token, minutes: num(r.minutes), threshold: num(r.threshold), status: r.status, at: r.at })) },
    recoverable: { noShow30: num(rec.no_show), hold30: num(rec.hold), list: recoverList },
  };
}

export const getOperations = () => cache.get('ops', compute);

/** Branch spellings (Okaya / Okaya Centre / NOIDA-2, Jaldarshan / AHMEDABAD-JALDARSHAN) collapse into one canonical row. */
function mergeBranches(rows: Record<string, string | number>[]) {
  const m = new Map<string, { name: string; arrived: number; waiting: number; breach: number; selected: number }>();
  for (const b of rows) {
    const k = branchDisplay(b.name), x = m.get(k) ?? { name: k, arrived: 0, waiting: 0, breach: 0, selected: 0 };
    x.arrived += num(b.arrived); x.waiting += num(b.waiting); x.breach += num(b.breach); x.selected += num(b.selected);
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.arrived - a.arrived);
}
