import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import type { AiAction, AiGenerateResponse, AiInsight } from './ai-provider.types.js';
import { resolveDashboardScope, buildScopeWhereEmployees } from '../../shared/dashboardScope.js';
import {
  buildDisciplinePoints,
  buildGrowthPoints,
  buildPerformancePoints,
  buildWellbeingPoints,
  buildTeamPoints,
  coachGreeting,
  renderCoachReport,
  tenureMonths,
  type TeamMemberSignal,
  type AttendanceWindow,
  type KpiSnapshot,
} from './ai-coach.service.js';

export const MIRA_NAME = 'Mira';
export const MIRA_TAGLINE = 'Your private HR assistant';

export type AccountIntent =
  | 'coach'
  | 'account_overview'
  | 'profile'
  | 'salary'
  | 'leave'
  | 'attendance'
  | 'roster'
  | 'documents'
  | 'pending_actions'
  | 'support'
  | 'payroll_readiness'
  | 'loans'
  | 'reimbursements'
  | 'journey'
  | 'help'
  | 'scope_violation'
  | 'unknown';

export interface AccountAnswerResult {
  handled: boolean;
  intent: AccountIntent;
  response?: AiGenerateResponse;
}

export class MiraDataUnavailableError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super('Mira could not read the requested HRMS data right now.');
    this.name = 'MiraDataUnavailableError';
    this.operation = operation;
  }
}

const INTENTS: Array<{ intent: AccountIntent; patterns: RegExp[] }> = [
  // Listed first so "coach my attendance" reaches the coach rather than the
  // single-number attendance intent.
  { intent: 'coach', patterns: [/\bcoach\b/i, /\bhow am i doing\b/i, /\bmy performance\b/i, /\bperformance review\b/i, /\bmotivate\b/i, /\bmotivation\b/i, /\bmy progress\b/i, /\banaly[sz]e (?:me|my (?:data|performance|work|record))\b/i, /\bhow can i improve\b/i, /\bwhere (?:do i stand|am i lagging)\b/i, /\bmeri performance\b/i, /\bkaisa (?:kaam )?kar raha hoon\b/i, /\bmujhe guide karo\b/i] },
  { intent: 'salary', patterns: [/\bsalary\b/i, /\bpayslip\b/i, /\bpay slip\b/i, /\bnet pay\b/i, /\bgross pay\b/i, /\btake[ -]?home\b/i, /\bctc\b/i, /\bearnings?\b/i, /\bdeductions?\b/i, /meri salary/i, /mera payslip/i, /kitna pay/i] },
  { intent: 'leave', patterns: [/\bleave balance\b/i, /\bleaves? (?:left|remaining)\b/i, /\bcasual leave\b/i, /\bsick leave\b/i, /\bprivilege leave\b/i, /\bannual leave\b/i, /\bmy leaves?\b/i, /meri leave/i, /kitni chhutti/i, /chhutti (?:baki|remaining)/i] },
  { intent: 'attendance', patterns: [/\battendance\b/i, /\bpunch(?:ed|ing)?\b/i, /\bclock(?:ed)?[ -]?in\b/i, /\babsent\b/i, /\bpresent days?\b/i, /\blate marks?\b/i, /\blwp\b/i, /\bworking hours?\b/i, /how many days (?:was i|did i) (?:present|attend)/i, /meri attendance/i, /mera punch/i, /kitne din (?:present|attend)/i, /aaj (?:ka )?punch/i, /aaj present/i, /kal (?:ka )?attendance/i] },
  { intent: 'roster', patterns: [/\broster\b/i, /\bmy shift\b/i, /\bshift timing\b/i, /\bweek(?:ly)? off\b/i, /\btomorrow(?:'s)? shift\b/i, /\bholiday\b/i, /meri shift/i, /mera roster/i, /kal ki shift/i, /week off kab/i] },
  { intent: 'documents', patterns: [/\bdocuments?\b/i, /\bdoc status\b/i, /\bkyc\b/i, /\bmissing docs?\b/i, /\bverified docs?\b/i] },
  { intent: 'pending_actions', patterns: [/\bpending actions?\b/i, /\bpending tasks?\b/i, /\bmy inbox\b/i, /\bwork inbox\b/i, /\bapprovals? pending\b/i, /\bwhat do i need to do\b/i, /\bactions? (?:are )?pending (?:from|for) my side\b/i] },
  { intent: 'support', patterns: [/\bhelpdesk\b/i, /\bsupport tickets?\b/i, /\bmy tickets?\b/i, /\bgrievances?\b/i, /\bcomplaints?\b/i] },
  { intent: 'payroll_readiness', patterns: [/\bpayroll readiness\b/i, /\bpayroll blocked\b/i, /\bsalary hold\b/i, /\bpayroll status\b/i] },
  { intent: 'loans', patterns: [/\bloan\b/i, /\badvance recovery\b/i, /\binstallments?\b/i, /\bemi\b/i] },
  { intent: 'reimbursements', patterns: [/\breimbursement\b/i, /\bexpense claim\b/i, /\bclaim status\b/i, /\bmedical claim\b/i, /\blta claim\b/i] },
  { intent: 'journey', patterns: [/\bemployee journey\b/i, /\bemployment history\b/i, /\bmy history\b/i, /\bcareer history\b/i, /\bjoining history\b/i] },
  { intent: 'profile', patterns: [/\bmy profile\b/i, /\bmy details\b/i, /\bemployee code\b/i, /\bjoining date\b/i, /\bdesignation\b/i, /\breporting manager\b/i, /\bmy branch\b/i, /\bmy process\b/i] },
  { intent: 'account_overview', patterns: [/\bmy account\b/i, /\baccount summary\b/i, /\bmy summary\b/i, /\boverview\b/i, /\bwhat is happening with my account\b/i, /\bwhat needs my attention\b/i] },
  { intent: 'help', patterns: [/^help$/i, /\bwhat can you do\b/i, /\bhow can you help\b/i, /\bshow capabilities\b/i] },
];

/**
 * Words that can follow "attendance for …" without naming another person: the
 * asker themselves, or a point in time. Everything else after of/for is treated
 * as a person reference and refused.
 */
const SELF_OR_TIME_WORDS = [
  'me', 'my', 'mine', 'myself', 'our',
  'today', 'yesterday', 'tomorrow', 'this', 'these', 'last', 'previous',
  'current', 'present', 'next', 'coming', 'date', 'dates',
  'year', 'years', 'month', 'months', 'week', 'weeks', 'day', 'days',
  'quarter', 'period',
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'q[1-4]', 'fy', 'ytd', '\\d+',
].join('|');

const DETERMINERS = 'the|a|an|any|each|every|per';

/**
 * "<subject> of/for <someone>" — refused unless what follows is the asker or a
 * date.
 *
 * The determiner is matched as two explicit branches rather than one optional
 * group: with `(?:DET\s+)?` the engine backtracks out of the determiner and then
 * judges the determiner itself, which refused "leave for the month" while
 * letting "payslip for the other employee" through.
 */
const CROSS_EMPLOYEE_SUBJECT_REFERENCE = new RegExp(
  `\\b(salary|attendance|leave|profile|details|documents|payslip)\\s+(?:of|for)\\s+` +
  `(?:(?:${DETERMINERS})\\s+(?!(?:${SELF_OR_TIME_WORDS})\\b)` +
  `|(?!(?:${DETERMINERS})\\b)(?!(?:${SELF_OR_TIME_WORDS})\\b))`,
  'i',
);

const CROSS_EMPLOYEE_PATTERNS = [
  /\b(other|another|someone else(?:'s)?|his|her|their)\s+(employee\s+)?(salary|attendance|leave|profile|details|documents|payslip)\b/i,
  CROSS_EMPLOYEE_SUBJECT_REFERENCE,
  /\bwhich employees?\b/i,
  /\bwhose\s+(?:salary|attendance|leave|profile|details|documents?|payslip|shift|loan|reimbursement)\b/i,
  /\bwho (?:has|is|was|needs|did)\b[^?.]{0,120}\b(?:salary|attendance|leave|profile|documents?|payslip|absent|late|lwp|shift|week[ -]?off|pending|approval|loan|reimbursement)\b/i,
  /\bemployee\s+(?:code|id)\s*[:#-]?\s*[a-z0-9_-]+\b/i,
];

export function detectMiraIntent(question: string): AccountIntent {
  const text = String(question ?? '').trim();
  if (CROSS_EMPLOYEE_PATTERNS.some((pattern) => pattern.test(text))) return 'scope_violation';
  for (const entry of INTENTS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) return entry.intent;
  }
  return 'unknown';
}

const CACHE_TTL_MS = 15_000;
const CACHE_LIMIT = 2_000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

export function clearMiraCacheForUser(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) if (key.startsWith(`${userId}:`)) cache.delete(key);
}

async function cached<T>(userId: string, intent: string, loader: () => Promise<T>): Promise<T> {
  const key = `${userId}:${intent}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  if (hit) cache.delete(key);
  const value = await loader();
  for (const [cacheKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(cacheKey);
  while (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

async function rows(operation: string, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  try {
    const [result] = await db.execute<RowDataPacket[]>(sql, params);
    return result;
  } catch (error) {
    console.error(`[Mira] ${operation} query failed`, error instanceof Error ? error.message : error);
    throw new MiraDataUnavailableError(operation);
  }
}

async function one(operation: string, sql: string, params: unknown[] = []): Promise<RowDataPacket> {
  return (await rows(operation, sql, params))[0] ?? ({} as RowDataPacket);
}

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const t = (value: unknown, fallback = 'Not available'): string => String(value ?? '').trim() || fallback;

const money = (value: unknown): string => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
}).format(n(value));

function date(value: unknown): string {
  if (!value) return 'Not available';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parsed = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00+05:30`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(parsed);
}

function indiaYear(): number {
  return Number(new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date()));
}

function indiaMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', timeZone: 'Asia/Kolkata',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value ?? ''}-${parts.find((part) => part.type === 'month')?.value ?? ''}`;
}

function action(label = 'Open my dashboard', url = '/my-dashboard'): AiAction {
  return { key: url.replace(/\W+/g, '-') || 'dashboard', label, url, priority: 'low' };
}

function response(
  intent: AccountIntent,
  answer: string,
  startedAt: number,
  insights: AiInsight[] = [],
  actions: AiAction[] = [],
  confidence = 1,
): AiGenerateResponse {
  return {
    answer,
    provider: 'mira-secure-local',
    model: 'hrms-self-account-v2',
    latencyMs: Math.max(1, Date.now() - startedAt),
    safetyBlocked: false,
    fallbackUsed: false,
    generatedAt: new Date().toISOString(),
    sourceContexts: [`self_account:${intent}`],
    dataConfidence: { overall: confidence },
    insights,
    actions,
  };
}

const handled = (
  intent: AccountIntent,
  answer: string,
  startedAt: number,
  insights: AiInsight[] = [],
  actions: AiAction[] = [],
  confidence = 1,
): AccountAnswerResult => ({ handled: true, intent, response: response(intent, answer, startedAt, insights, actions, confidence) });

async function profile(employeeId: string): Promise<RowDataPacket> {
  return one('profile', `SELECT e.full_name, e.employee_code, e.date_of_joining, e.employment_status, e.employment_type,
      b.branch_name, p.process_name, d.designation_name, m.full_name AS reporting_manager_name
    FROM employees e
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN designation_master d ON d.id = e.designation_id
    LEFT JOIN employees m ON m.id = e.reporting_manager_id
    WHERE e.id = ? LIMIT 1`, [employeeId]);
}

async function salary(employeeId: string): Promise<RowDataPacket> {
  return one('salary', `SELECT spl.gross_salary, spl.total_deductions, spl.net_salary, spl.basic, spl.hra,
      spl.special_allowance, spl.pf_employee, spl.esic_employee, spl.professional_tax, spl.tds,
      spl.lwp_deduction, spl.advance_recovery, spl.present_days, spl.working_days, spl.lwp_days,
      spr.run_month, spr.status AS run_status
    FROM salary_prep_line spl
    JOIN salary_prep_run spr ON spr.id = spl.run_id
    WHERE spl.employee_id = ? AND spr.status <> 'draft'
    ORDER BY spr.run_month DESC LIMIT 1`, [employeeId]);
}

async function leave(employeeId: string): Promise<{ year: number; rows: RowDataPacket[] }> {
  const year = indiaYear();
  return {
    year,
    rows: await rows('leave', `SELECT lt.leave_name, lt.leave_code, lbl.allocated_days, lbl.used_days, lbl.adjusted_days
      FROM leave_balance_ledger lbl
      JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
      WHERE lbl.employee_id = ? AND lbl.balance_year = ?
      ORDER BY lt.leave_name`, [employeeId, year]),
  };
}

type AttendanceScope = 'today' | 'yesterday' | 'previous_month' | 'month_to_date';

function attendanceScope(question: string): AttendanceScope {
  if (/\b(today|aaj)\b/i.test(question)) return 'today';
  if (/\b(yesterday|kal ka|kal ki)\b/i.test(question)) return 'yesterday';
  if (/\b(last|previous|pichhle|pichla) month\b/i.test(question)) return 'previous_month';
  return 'month_to_date';
}

async function attendance(employeeId: string, question = ''): Promise<{ label: string; scope: AttendanceScope; row: RowDataPacket }> {
  const scope = attendanceScope(question);
  const predicates: Record<AttendanceScope, string> = {
    today: 'record_date = CURDATE()',
    yesterday: 'record_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)',
    previous_month: `record_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
      AND record_date <= LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))`,
    month_to_date: `record_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND record_date <= CURDATE()`,
  };
  const labels: Record<AttendanceScope, string> = {
    today: 'today', yesterday: 'yesterday', previous_month: 'the previous month', month_to_date: indiaMonth(),
  };
  return {
    label: labels[scope],
    scope,
    row: await one('attendance', `SELECT SUM(attendance_status = 'present') AS present_days,
        SUM(attendance_status = 'half_day') AS half_days,
        SUM(attendance_status = 'absent') AS absent_days,
        SUM(attendance_status = 'leave_approved') AS leave_days,
        SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late_marks,
        SUM(COALESCE(lwp_value, 0)) AS lwp_days,
        ROUND(SUM(COALESCE(raw_minutes, 0)) / 60, 2) AS total_hours,
        COUNT(CASE WHEN attendance_status NOT IN ('holiday','week_off') THEN 1 END) AS working_days,
        DATE_FORMAT(MIN(clock_in_time), '%h:%i %p') AS first_clock_in,
        DATE_FORMAT(MAX(clock_out_time), '%h:%i %p') AS last_clock_out,
        MAX(attendance_status) AS latest_status,
        MAX(attendance_source) AS attendance_source
      FROM attendance_daily_record
      WHERE employee_id = ? AND ${predicates[scope]}`, [employeeId]),
  };
}

/** Attendance totals for a window ending `offsetDays` ago, `spanDays` long. */
async function attendanceWindow(
  employeeId: string,
  offsetDays: number,
  spanDays: number,
): Promise<AttendanceWindow> {
  const row = await one('coach_attendance', `SELECT
      SUM(attendance_status = 'present') AS present_days,
      SUM(attendance_status = 'absent') AS absent_days,
      SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late_marks,
      SUM(COALESCE(lwp_value, 0)) AS lwp_days,
      COUNT(CASE WHEN attendance_status NOT IN ('holiday','week_off') THEN 1 END) AS working_days
    FROM attendance_daily_record
    WHERE employee_id = ?
      AND record_date > DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND record_date <= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [employeeId, offsetDays + spanDays, offsetDays]);

  return {
    presentDays: Number(row.present_days ?? 0),
    absentDays: Number(row.absent_days ?? 0),
    lateMarks: Number(row.late_marks ?? 0),
    lwpDays: Number(row.lwp_days ?? 0),
    workingDays: Number(row.working_days ?? 0),
  };
}

/** Published KPI readings for this employee, with the metric's own target and sample floor. */
async function coachKpis(employeeId: string, expectedSampleCount: number | null): Promise<KpiSnapshot[]> {
  const found = await rows('coach_kpi', `SELECT m.metric_name, m.unit, m.direction, m.minimum_sample_size,
      ker.target_value, ROUND(AVG(k.actual_value), 2) AS average_actual, COUNT(*) AS sample_count
    FROM kpi_daily_actual k
    JOIN kpi_metric_master m ON m.id = k.metric_id
    LEFT JOIN kpi_employee_resolved ker ON ker.employee_id = k.employee_id AND ker.metric_id = k.metric_id
    WHERE k.employee_id = ? AND k.score_date > DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    GROUP BY m.id, m.metric_name, m.unit, m.direction, m.minimum_sample_size, ker.target_value
    ORDER BY m.display_order, m.metric_name`, [employeeId]);

  return found.map((row) => ({
    metricName: String(row.metric_name ?? 'Unnamed metric'),
    unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
    direction: row.direction === null || row.direction === undefined ? null : String(row.direction),
    targetValue: row.target_value === null || row.target_value === undefined ? null : Number(row.target_value),
    averageActual: row.average_actual === null || row.average_actual === undefined ? null : Number(row.average_actual),
    sampleCount: Number(row.sample_count ?? 0),
    minimumSampleSize: row.minimum_sample_size === null || row.minimum_sample_size === undefined
      ? null : Number(row.minimum_sample_size),
    expectedSampleCount,
  }));
}

/**
 * Attendance signal for the members a manager's assignment scope grants them.
 *
 * The row filter comes from resolveDashboardScope, the same enforcement the WFM
 * and KPI dashboards use, so the coach can never widen what its caller can
 * already see. Attendance columns only — no salary, statutory or bank field is
 * selected here, deliberately.
 */
async function teamSignals(userId: string, roleKeys: string[]): Promise<{ members: TeamMemberSignal[]; total: number; orgWide: boolean } | null> {
  const scope = await resolveDashboardScope(userId, roleKeys[0] ?? 'employee');
  if (scope.level === 'SELF_ONLY') return null;

  const where = buildScopeWhereEmployees(scope, 'e');
  if (where.sql === '1=0') return { members: [], total: 0, orgWide: false };

  // No ORDER BY: the display lists are re-sorted by severity in TypeScript, so
  // sorting 1,300+ grouped rows by name here bought a filesort and nothing else.
  // COUNT(*) OVER () carries the true scope size, which previously cost a second
  // round trip of its own.
  const found = await rows('coach_team', `SELECT e.id AS employee_id, e.full_name,
      SUM(CASE WHEN a.late_mark = 1 THEN 1 ELSE 0 END) AS late_marks,
      SUM(COALESCE(a.lwp_value, 0)) AS lwp_days,
      SUM(a.attendance_status = 'present') AS present_days,
      COUNT(CASE WHEN a.attendance_status NOT IN ('holiday','week_off') THEN 1 END) AS working_days,
      COUNT(*) OVER () AS scope_total
    FROM employees e
    JOIN attendance_daily_record a ON a.employee_id = e.id
      AND a.record_date > DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    WHERE e.active_status = 1 AND ${where.sql}
    GROUP BY e.id, e.full_name
    LIMIT 500`, where.params);

  return {
    orgWide: scope.level === 'ORG_ALL',
    // The list is capped, so the headline count must not come from its length —
    // otherwise the cap silently becomes the reported team size.
    total: Number(found[0]?.scope_total ?? found.length),
    members: found.map((row) => ({
      employeeId: String(row.employee_id),
      name: String(row.full_name ?? 'Unnamed'),
      lateMarks: Number(row.late_marks ?? 0),
      lwpDays: Number(row.lwp_days ?? 0),
      presentDays: Number(row.present_days ?? 0),
      workingDays: Number(row.working_days ?? 0),
    })),
  };
}

async function roster(employeeId: string): Promise<RowDataPacket[]> {
  return rows('roster', `SELECT DATE_FORMAT(rda.roster_date, '%Y-%m-%d') AS roster_date,
      st.shift_name, st.start_time, st.end_time, rda.is_week_off, rda.is_holiday, rda.acknowledgement_status
    FROM roster_daily_assignment rda
    JOIN weekly_roster_cycle c ON c.id = rda.cycle_id
    LEFT JOIN wfm_shift_template st ON st.id = rda.shift_template_id
    WHERE rda.employee_id = ?
      AND rda.roster_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 6 DAY)
      AND c.status IN ('published','acknowledged','active','attendance_locked','payroll_input_ready','closed')
    ORDER BY rda.roster_date`, [employeeId]);
}

async function documents(employeeId: string): Promise<RowDataPacket[]> {
  return rows('documents', `SELECT doc_type, doc_name, verified, created_at
    FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC LIMIT 100`, [employeeId]);
}

async function pendingActions(userId: string, roleKeys: string[]): Promise<RowDataPacket[]> {
  const roles = Array.from(new Set(roleKeys.map((role) => String(role).trim().toLowerCase()).filter(Boolean)));
  if (!roles.length) roles.push('employee');
  const placeholders = roles.map(() => '?').join(',');
  return rows('pending_actions', `SELECT item_type, title, module_code, priority, status, due_at
    FROM work_item
    WHERE (assigned_to_user_id = ? OR assigned_to_role IN (${placeholders}))
      AND status NOT IN ('completed','cancelled')
    ORDER BY FIELD(priority,'critical','high','medium','low'), due_at ASC LIMIT 12`, [userId, ...roles]);
}

async function support(employeeId: string): Promise<{ tickets: RowDataPacket[]; grievances: RowDataPacket[] }> {
  const [tickets, grievances] = await Promise.all([
    rows('support_tickets', `SELECT ticket_code, category, subject, priority, status, sla_due_at, created_at
      FROM helpdesk_ticket WHERE employee_id = ? ORDER BY created_at DESC LIMIT 10`, [employeeId]),
    rows('grievances', `SELECT category, severity, status, created_at, resolved_at
      FROM grievance WHERE employee_id = ? AND (is_anonymous = 0 OR is_anonymous IS NULL)
      ORDER BY created_at DESC LIMIT 10`, [employeeId]),
  ]);
  return { tickets, grievances };
}

async function payrollReadiness(employeeId: string): Promise<RowDataPacket> {
  return one('payroll_readiness', `SELECT period_start, period_end, readiness_status, blocker_summary, confidence_score, scanned_at
    FROM payroll_readiness_snapshot WHERE employee_id = ? ORDER BY scanned_at DESC LIMIT 1`, [employeeId]);
}

async function loans(employeeId: string): Promise<RowDataPacket[]> {
  return rows('loans', `SELECT loan_type, amount, deduction_per_month, deducted_amount, pending_amount,
      installments, start_date, end_date, status
    FROM employee_loans WHERE employee_id = ? ORDER BY created_at DESC LIMIT 10`, [employeeId]);
}

async function reimbursements(employeeId: string): Promise<RowDataPacket[]> {
  return rows('reimbursements', `SELECT claim_type, claim_month, amount_claimed, amount_approved, status,
      submitted_at, approved_at, rejection_reason, processed_at
    FROM employee_reimbursement_claim WHERE employee_id = ? ORDER BY created_at DESC LIMIT 10`, [employeeId]);
}

async function journey(employeeId: string): Promise<RowDataPacket[]> {
  return rows('journey', `SELECT event_type, event_date, description, module
    FROM employee_journey_log WHERE employee_id = ? ORDER BY event_date DESC, created_at DESC LIMIT 12`, [employeeId]);
}

function helpText(): string {
  return `${MIRA_NAME} can privately answer questions about your own HRMS account, including:\n\n` +
    `• profile, employee code, joining date, branch, process and reporting manager\n` +
    `• salary and payslip summary\n` +
    `• leave balances\n` +
    `• attendance, late marks, LWP and working hours\n` +
    `• roster, shift and week-off\n` +
    `• document verification status\n` +
    `• pending work items and approvals\n` +
    `• helpdesk tickets and grievances\n` +
    `• payroll readiness, loans and reimbursement claims\n` +
    `• approved public MAS Callnet information such as leadership, offices and careers\n\n` +
    `For privacy, ${MIRA_NAME} will not disclose another employee's personal account information in chat.`;
}

export function getMiraSuggestedPrompts(): string[] {
  return [
    'Give me my account summary',
    'Show my latest salary breakup',
    'How many leaves do I have left?',
    'Summarize my attendance this month',
    'Was my punch recorded today?',
    'What is my shift for the next 7 days?',
    'Which documents are pending verification?',
    'What actions are pending from my side?',
    'Show my loan or reimbursement status',
    'Who is the CEO of MAS Callnet?',
    'Who are the current branch heads?',
  ];
}

export async function answerSelfAccountQuestion(
  question: string,
  userId: string,
  roleKeys: string[],
): Promise<AccountAnswerResult> {
  const startedAt = Date.now();
  const intent = detectMiraIntent(question);
  if (intent === 'unknown') return { handled: false, intent };
  if (intent === 'scope_violation') {
    return handled(intent,
      `I can only discuss your own account in this chat. I will not reveal another employee's salary, attendance, leave, documents, profile, or other personal HR information. Authorised business users should use the relevant scoped HRMS dashboard instead.`,
      startedAt,
      [{ key: 'privacy-protected', label: 'Other employee data blocked', severity: 'low' }]);
  }
  if (intent === 'help') return handled(intent, helpText(), startedAt, [], [action()]);

  const employee = await getEmployeeForUser(userId);
  if (!employee?.id) {
    return handled(intent,
      'Your login is not linked to an active employee record. Please contact HR or the HRMS administrator to correct the user-to-employee mapping.',
      startedAt,
      [{ key: 'employee-map-missing', label: 'Employee mapping missing', severity: 'high' }], [], 0.25);
  }
  const employeeId = employee.id;

  if (intent === 'coach') {
    const [recent, previous, quarter, leaveRows, profileRow] = await Promise.all([
      attendanceWindow(employeeId, 0, 30),
      attendanceWindow(employeeId, 30, 30),
      attendanceWindow(employeeId, 0, 90),
      leave(employeeId),
      profile(employeeId),
    ]);
    const [kpis, team] = await Promise.all([
      coachKpis(employeeId, quarter.workingDays || null),
      cached(userId, 'coach_team', () => teamSignals(userId, roleKeys)).catch(() => null),
    ]);

    const leaveSnapshots = leaveRows.rows.map((row) => {
      const allocated = Number(row.allocated_days ?? 0) + Number(row.adjusted_days ?? 0);
      const used = Number(row.used_days ?? 0);
      return { leaveName: String(row.leave_name ?? 'Leave'), allocated, used, available: allocated - used };
    });

    const joinedAt = profileRow.date_of_joining ? new Date(String(profileRow.date_of_joining)) : null;
    const points = [
      ...buildPerformancePoints(kpis),
      ...buildDisciplinePoints(recent, previous),
      ...buildWellbeingPoints(leaveSnapshots),
      ...(joinedAt && !Number.isNaN(joinedAt.getTime())
        ? buildGrowthPoints(tenureMonths(joinedAt, new Date()))
        : []),
    ];
    const teamPoints = team ? buildTeamPoints(team.members, team.total) : [];

    const allPoints = [...points, ...teamPoints];
    const needsAction = allPoints.filter((point) => point.tone === 'act').length;
    const greeting = coachGreeting({
      fullName: profileRow.full_name ? String(profileRow.full_name) : null,
      branchName: profileRow.branch_name ? String(profileRow.branch_name) : null,
      processName: profileRow.process_name ? String(profileRow.process_name) : null,
      isTeamView: Boolean(team),
    }, needsAction);

    const teamHeading = team?.orgWide ? 'Across the organisation' : 'Your team';
    const body = team
      ? `${renderCoachReport(points)}

---

**${teamHeading}**

${renderCoachReport(teamPoints)}`
      : renderCoachReport(points);

    const coachInsights: AiInsight[] = [
      { key: 'coach-actions', label: `${needsAction} item${needsAction === 1 ? '' : 's'} to act on`, count: needsAction, severity: needsAction ? 'medium' : 'low' },
      { key: 'coach-kpis', label: `${kpis.length} KPI metric${kpis.length === 1 ? '' : 's'} tracked`, count: kpis.length, severity: 'low' },
    ];
    if (team) {
      coachInsights.push({ key: 'coach-team', label: `${team.total} ${team.total === 1 ? 'person' : 'people'} in scope`, count: team.total, severity: 'low' });
    }

    return handled(intent, `${greeting}

${body}`, startedAt, coachInsights,
      [action('Open my dashboard'), action('Open leave dashboard', '/leave')]);
  }

  if (intent === 'profile') {
    const row = await cached(userId, intent, () => profile(employeeId));
    if (!row.employee_code) return handled(intent, 'Your profile record could not be loaded right now.', startedAt, [], [], 0.3);
    return handled(intent, `Here are your current profile details:\n\n` +
      `• Name: ${t(row.full_name)}\n• Employee code: ${t(row.employee_code)}\n• Joining date: ${date(row.date_of_joining)}\n` +
      `• Employment status: ${t(row.employment_status)}\n• Employment type: ${t(row.employment_type)}\n` +
      `• Branch: ${t(row.branch_name)}\n• Process: ${t(row.process_name)}\n• Reporting manager: ${t(row.reporting_manager_name)}`,
      startedAt, [], [action('Open my profile dashboard')]);
  }

  if (intent === 'salary') {
    const row = await cached(userId, intent, () => salary(employeeId));
    if (!row.run_month) return handled(intent, 'No finalized payslip or salary preparation record is available for your account yet.', startedAt, [], [action()], 0.5);
    return handled(intent, `Your latest finalized salary summary for ${t(row.run_month)} is:\n\n` +
      `• Gross earnings: ${money(row.gross_salary)}\n• Total deductions: ${money(row.total_deductions)}\n` +
      `• Net take-home: ${money(row.net_salary)}\n• Basic: ${money(row.basic)}\n• HRA: ${money(row.hra)}\n` +
      `• Special allowance: ${money(row.special_allowance)}\n• PF: ${money(row.pf_employee)}\n• ESIC: ${money(row.esic_employee)}\n` +
      `• Professional tax: ${money(row.professional_tax)}\n• TDS: ${money(row.tds)}\n` +
      `• LWP deduction: ${money(row.lwp_deduction)}\n• Advance recovery: ${money(row.advance_recovery)}\n` +
      `• Present / working days: ${n(row.present_days)} / ${n(row.working_days)}`,
      startedAt, [{ key: 'net-pay', label: 'Net take-home', value: n(row.net_salary), severity: 'low' }], [action('Open payroll dashboard')]);
  }

  if (intent === 'leave') {
    const data = await cached(userId, intent, () => leave(employeeId));
    if (!data.rows.length) return handled(intent, `No leave balance ledger is available for ${data.year}. Please check with HR if allocation should already be visible.`, startedAt, [], [action()], 0.5);
    const lines = data.rows.map((row) => {
      const available = Math.max(0, n(row.allocated_days) + n(row.adjusted_days) - n(row.used_days));
      return `• ${t(row.leave_name)} (${t(row.leave_code)}): ${available} available, ${n(row.used_days)} used, ${n(row.allocated_days)} allocated`;
    });
    return handled(intent, `Your ${data.year} leave balances are:\n\n${lines.join('\n')}`, startedAt,
      [{ key: 'leave-types', label: `${data.rows.length} leave types found`, count: data.rows.length, severity: 'low' }], [action('Open leave dashboard')]);
  }

  if (intent === 'attendance') {
    const scope = attendanceScope(question);
    const data = await cached(userId, `${intent}:${scope}`, () => attendance(employeeId, question));
    const working = n(data.row.working_days);
    const equivalent = n(data.row.present_days) + n(data.row.half_days) * 0.5;
    const percentage = working ? Math.round((equivalent / working) * 1000) / 10 : 0;
    return handled(intent, `Your attendance summary for ${data.label} is:\n\n` +
      `• Present days: ${n(data.row.present_days)}\n• Half days: ${n(data.row.half_days)}\n• Absent days: ${n(data.row.absent_days)}\n` +
      `• Approved leave days: ${n(data.row.leave_days)}\n• Late marks: ${n(data.row.late_marks)}\n• LWP days: ${n(data.row.lwp_days)}\n• Hours logged: ${n(data.row.total_hours)}\n` +
      `${data.scope === 'today' || data.scope === 'yesterday' ? `• Status: ${t(data.row.latest_status)}\n• First punch: ${t(data.row.first_clock_in)}\n• Last punch: ${t(data.row.last_clock_out)}\n• Source: ${t(data.row.attendance_source)}\n` : ''}` +
      `• Attendance percentage: ${percentage}%`, startedAt,
      [{ key: 'attendance-percent', label: `${percentage}% attendance`, value: percentage, severity: percentage < 85 ? 'high' : percentage < 95 ? 'medium' : 'low' }],
      [action('Open attendance', '/attendance')]);
  }

  if (intent === 'roster') {
    const data = await cached(userId, intent, () => roster(employeeId));
    if (!data.length) return handled(intent, 'No published roster is available for your account for the next 7 days.', startedAt, [], [action()], 0.5);
    const lines = data.map((row) => n(row.is_week_off) === 1 ? `• ${date(row.roster_date)}: Week off`
      : n(row.is_holiday) === 1 ? `• ${date(row.roster_date)}: Holiday`
        : `• ${date(row.roster_date)}: ${t(row.shift_name, 'Shift')} (${t(row.start_time, '--')}–${t(row.end_time, '--')})`);
    return handled(intent, `Your published roster for the next 7 days:\n\n${lines.join('\n')}`, startedAt, [], [action('Open roster dashboard')]);
  }

  if (intent === 'documents') {
    const data = await cached(userId, intent, () => documents(employeeId));
    if (!data.length) return handled(intent, 'No employee document records are currently visible in your account.', startedAt, [], [action()], 0.5);
    const verified = data.filter((row) => n(row.verified) === 1).length;
    const pending = data.filter((row) => n(row.verified) !== 1);
    const names = pending.slice(0, 8).map((row) => t(row.doc_name, t(row.doc_type))).join(', ');
    return handled(intent, `Your document status:\n\n• Total documents: ${data.length}\n• Verified: ${verified}\n• Pending verification: ${pending.length}${names ? `\n• Pending items: ${names}` : ''}`,
      startedAt, [{ key: 'pending-documents', label: `${pending.length} pending documents`, count: pending.length, severity: pending.length ? 'medium' : 'low' }], [action('Open document dashboard')]);
  }

  if (intent === 'pending_actions') {
    const data = await cached(userId, intent, () => pendingActions(userId, roleKeys));
    if (!data.length) return handled(intent, 'You have no open work items or assigned approvals at the moment.', startedAt,
      [{ key: 'pending-actions', label: 'No pending actions', count: 0, severity: 'low' }], [action()]);
    const lines = data.slice(0, 8).map((row) => `• [${t(row.priority, 'medium')}] ${t(row.title)}${row.due_at ? ` — due ${date(row.due_at)}` : ''}`);
    return handled(intent, `You have ${data.length} open assigned item(s). The highest-priority items are:\n\n${lines.join('\n')}`, startedAt,
      [{ key: 'pending-actions', label: `${data.length} pending actions`, count: data.length, severity: data.some((row) => row.priority === 'critical') ? 'critical' : 'medium' }], [action('Open work dashboard')]);
  }

  if (intent === 'support') {
    const data = await cached(userId, intent, () => support(employeeId));
    const openTickets = data.tickets.filter((row) => !['resolved', 'closed'].includes(String(row.status))).length;
    const openGrievances = data.grievances.filter((row) => !['resolved', 'closed'].includes(String(row.status))).length;
    return handled(intent, `Your support status:\n\n• Helpdesk tickets: ${data.tickets.length} recent, ${openTickets} open\n` +
      `• Grievances: ${data.grievances.length} recent, ${openGrievances} open${data.tickets[0] ? `\n• Latest ticket: ${t(data.tickets[0].subject)} — ${t(data.tickets[0].status)}` : ''}`,
      startedAt, [{ key: 'open-support', label: `${openTickets + openGrievances} open support items`, count: openTickets + openGrievances, severity: openTickets + openGrievances ? 'medium' : 'low' }], [action()]);
  }

  if (intent === 'payroll_readiness') {
    const row = await cached(userId, intent, () => payrollReadiness(employeeId));
    if (!row.readiness_status) return handled(intent, 'No payroll readiness scan is available for your account yet.', startedAt, [], [action()], 0.5);
    const blocked = ['blocked', 'hold'].includes(String(row.readiness_status).toLowerCase());
    return handled(intent, `Your latest payroll readiness status is ${t(row.readiness_status)} for ${date(row.period_start)} to ${date(row.period_end)}.` +
      `${row.blocker_summary ? `\n\nBlocker summary: ${t(row.blocker_summary)}` : ''}\nLast scanned: ${date(row.scanned_at)}`,
      startedAt, [{ key: 'payroll-readiness', label: `Payroll ${t(row.readiness_status)}`, severity: blocked ? 'high' : 'low' }],
      [action('Open payroll dashboard')], n(row.confidence_score) || 0.8);
  }

  if (intent === 'loans') {
    const data = await cached(userId, intent, () => loans(employeeId));
    if (!data.length) return handled(intent, 'No employee loan or salary advance record is linked to your account.', startedAt, [], [action()]);
    const pending = data.reduce((sum, row) => sum + n(row.pending_amount), 0);
    const lines = data.slice(0, 5).map((row) => `• ${t(row.loan_type)}: ${t(row.status)}, pending ${money(row.pending_amount)}, monthly deduction ${money(row.deduction_per_month)}`);
    return handled(intent, `Your loan/advance summary:\n\n${lines.join('\n')}\n\nTotal pending amount: ${money(pending)}`, startedAt,
      [{ key: 'loan-pending', label: 'Pending loan amount', value: pending, severity: pending > 0 ? 'medium' : 'low' }], [action('Open payroll dashboard')]);
  }

  if (intent === 'reimbursements') {
    const data = await cached(userId, intent, () => reimbursements(employeeId));
    if (!data.length) return handled(intent, 'No reimbursement claims are linked to your account.', startedAt, [], [action()]);
    const lines = data.slice(0, 8).map((row) => `• ${t(row.claim_type)} (${t(row.claim_month)}): ${t(row.status)}, claimed ${money(row.amount_claimed)}${row.amount_approved != null ? `, approved ${money(row.amount_approved)}` : ''}`);
    return handled(intent, `Your recent reimbursement claims:\n\n${lines.join('\n')}`, startedAt,
      [{ key: 'claims', label: `${data.length} recent claims`, count: data.length, severity: data.some((row) => row.status === 'rejected') ? 'medium' : 'low' }], [action('Open reimbursement dashboard')]);
  }

  if (intent === 'journey') {
    const data = await cached(userId, intent, () => journey(employeeId));
    if (!data.length) return handled(intent, 'No employee journey events are available for your account yet.', startedAt, [], [action()], 0.5);
    const lines = data.slice(0, 10).map((row) => `• ${date(row.event_date)} — ${t(row.event_type)}${row.description ? `: ${t(row.description)}` : ''}`);
    return handled(intent, `Your recent employee journey events:\n\n${lines.join('\n')}`, startedAt, [], [action('Open my dashboard')]);
  }

  if (intent === 'account_overview') {
    const p = await cached(userId, 'profile', () => profile(employeeId));
    const [attendanceResult, leaveResult, rosterResult, pendingResult] = await Promise.allSettled([
      cached(userId, 'attendance:month_to_date', () => attendance(employeeId, 'this month')),
      cached(userId, 'leave', () => leave(employeeId)),
      cached(userId, 'roster', () => roster(employeeId)),
      cached(userId, 'pending_actions', () => pendingActions(userId, roleKeys)),
    ]);
    const a = attendanceResult.status === 'fulfilled' ? attendanceResult.value : null;
    const l = leaveResult.status === 'fulfilled' ? leaveResult.value : null;
    const r = rosterResult.status === 'fulfilled' ? rosterResult.value : [];
    const pending = pendingResult.status === 'fulfilled' ? pendingResult.value : [];
    const totalLeave = l?.rows.reduce((sum, row) => sum + Math.max(0, n(row.allocated_days) + n(row.adjusted_days) - n(row.used_days)), 0) ?? 0;
    const next = r[0];
    const unavailable = [
      attendanceResult.status === 'rejected' ? 'attendance' : '',
      leaveResult.status === 'rejected' ? 'leave' : '',
      rosterResult.status === 'rejected' ? 'roster' : '',
      pendingResult.status === 'rejected' ? 'work items' : '',
    ].filter(Boolean);
    return handled(intent, `Here is your current HRMS account summary:\n\n` +
      `• Employee: ${t(p.full_name)} (${t(p.employee_code)})\n• Designation: ${t(p.designation_name)}\n• Branch / process: ${t(p.branch_name)} / ${t(p.process_name)}\n` +
      `• This month's attendance: ${a ? `${n(a.row.present_days)} present, ${n(a.row.absent_days)} absent, ${n(a.row.late_marks)} late marks` : 'Temporarily unavailable'}\n` +
      `• Leave available: ${l ? `${totalLeave} days across ${l.rows.length} leave types` : 'Temporarily unavailable'}\n` +
      `• Pending assigned actions: ${pendingResult.status === 'fulfilled' ? pending.length : 'Temporarily unavailable'}\n` +
      `• Next roster entry: ${rosterResult.status === 'rejected' ? 'Temporarily unavailable' : next ? `${date(next.roster_date)} — ${n(next.is_week_off) ? 'Week off' : n(next.is_holiday) ? 'Holiday' : t(next.shift_name, 'Shift')}` : 'Not published'}` +
      `${unavailable.length ? `\n\nSome sections could not be refreshed: ${unavailable.join(', ')}. The available information above is still live from HRMS.` : ''}`,
      startedAt, [
        { key: 'pending-actions', label: `${pending.length} pending actions`, count: pending.length, severity: pending.length ? 'medium' : 'low' },
        { key: 'leave-available', label: `${totalLeave} leave days available`, value: totalLeave, severity: 'low' },
      ], [action()], unavailable.length ? 0.8 : 1);
  }

  return { handled: false, intent: 'unknown' };
}
