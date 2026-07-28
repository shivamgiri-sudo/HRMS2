import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import type { AiAction, AiGenerateResponse, AiInsight } from './ai-provider.types.js';

export const MIRA_NAME = 'Mira';
export const MIRA_TAGLINE = 'Your private HR assistant';

export type AccountIntent =
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

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { expiresAt: number; value: Record<string, unknown> }>();

const INTENT_PATTERNS: Array<{ intent: AccountIntent; patterns: RegExp[] }> = [
  { intent: 'salary', patterns: [/\bsalary\b/i, /\bpayslip\b/i, /\bpay slip\b/i, /\bnet pay\b/i, /\bgross pay\b/i, /\btake[ -]?home\b/i, /\bctc\b/i, /\bearnings?\b/i, /\bdeductions?\b/i] },
  { intent: 'leave', patterns: [/\bleave balance\b/i, /\bleaves? left\b/i, /\bleaves? remaining\b/i, /\bcasual leave\b/i, /\bsick leave\b/i, /\bprivilege leave\b/i, /\bannual leave\b/i, /\bmy leaves?\b/i] },
  { intent: 'attendance', patterns: [/\battendance\b/i, /\bpunch(?:ed|ing)?\b/i, /\bclock(?:ed)?[ -]?in\b/i, /\babsent\b/i, /\bpresent days?\b/i, /\blate marks?\b/i, /\blwp\b/i, /\bworking hours?\b/i] },
  { intent: 'roster', patterns: [/\broster\b/i, /\bmy shift\b/i, /\bshift timing\b/i, /\bweek off\b/i, /\bweekly off\b/i, /\btomorrow(?:'s)? shift\b/i, /\bholiday\b/i] },
  { intent: 'documents', patterns: [/\bdocuments?\b/i, /\bdoc status\b/i, /\bkyc\b/i, /\bmissing docs?\b/i, /\bverified docs?\b/i] },
  { intent: 'pending_actions', patterns: [/\bpending actions?\b/i, /\bpending tasks?\b/i, /\bmy inbox\b/i, /\bwork inbox\b/i, /\bapprovals? pending\b/i, /\bwhat do i need to do\b/i] },
  { intent: 'support', patterns: [/\bhelpdesk\b/i, /\bsupport tickets?\b/i, /\bmy tickets?\b/i, /\bgrievances?\b/i, /\bcomplaints?\b/i] },
  { intent: 'payroll_readiness', patterns: [/\bpayroll readiness\b/i, /\bpayroll blocked\b/i, /\bsalary hold\b/i, /\bpayroll status\b/i] },
  { intent: 'loans', patterns: [/\bloan\b/i, /\badvance recovery\b/i, /\binstallments?\b/i, /\bemi\b/i] },
  { intent: 'reimbursements', patterns: [/\breimbursement\b/i, /\bexpense claim\b/i, /\bclaim status\b/i, /\bmedical claim\b/i, /\blta claim\b/i] },
  { intent: 'journey', patterns: [/\bemployee journey\b/i, /\bemployment history\b/i, /\bmy history\b/i, /\bcareer history\b/i, /\bjoining history\b/i] },
  { intent: 'profile', patterns: [/\bmy profile\b/i, /\bmy details\b/i, /\bemployee code\b/i, /\bjoining date\b/i, /\bdesignation\b/i, /\breporting manager\b/i, /\bmy branch\b/i, /\bmy process\b/i] },
  { intent: 'account_overview', patterns: [/\bmy account\b/i, /\baccount summary\b/i, /\bmy summary\b/i, /\boverview\b/i, /\bwhat is happening with my account\b/i, /\bwhat needs my attention\b/i] },
  { intent: 'help', patterns: [/^help$/i, /\bwhat can you do\b/i, /\bhow can you help\b/i, /\bshow capabilities\b/i] },
];

const OTHER_EMPLOYEE_PATTERNS = [
  /\b(other|another|someone else(?:'s)?|his|her|their)\s+(employee\s+)?(salary|attendance|leave|profile|details|documents|payslip)\b/i,
  /\b(salary|attendance|leave|profile|details|documents|payslip)\s+(of|for)\s+(?!me\b|my\b)/i,
  /\bwhich employees?\b/i,
  /\bwho (?:has|is|was|needs|did)\b/i,
  /\bemployee\s+(?:code|id)\s*[:#-]?\s*[a-z0-9_-]+\b/i,
];

function detectIntent(question: string): AccountIntent {
  if (OTHER_EMPLOYEE_PATTERNS.some((pattern) => pattern.test(question))) return 'scope_violation';
  for (const entry of INTENT_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(question))) return entry.intent;
  }
  return 'unknown';
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown, fallback = 'Not available'): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatCurrency(value: unknown): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(numberValue(value));
}

function formatDate(value: unknown): string {
  if (!value) return 'Not available';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

async function queryRows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows;
  } catch {
    return [];
  }
}

async function queryOne(sql: string, params: unknown[] = []): Promise<RowDataPacket> {
  const rows = await queryRows(sql, params);
  return rows[0] ?? ({} as RowDataPacket);
}

async function cached(
  userId: string,
  intent: AccountIntent,
  loader: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const key = `${userId}:${intent}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function localResponse(
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
    model: 'hrms-self-account-v1',
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

function dashboardAction(label = 'Open my dashboard'): AiAction {
  return { key: 'my-dashboard', label, url: '/my-dashboard', priority: 'low' };
}

async function fetchProfile(employeeId: string): Promise<Record<string, unknown>> {
  const row = await queryOne(
    `SELECT e.full_name, e.employee_code, e.date_of_joining, e.employment_status, e.employment_type,
            b.branch_name, p.process_name, m.full_name AS reporting_manager_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  return { row };
}

async function fetchSalary(employeeId: string): Promise<Record<string, unknown>> {
  const row = await queryOne(
    `SELECT spl.gross_salary, spl.total_deductions, spl.net_salary, spl.basic, spl.hra,
            spl.special_allowance, spl.pf_employee, spl.esic_employee, spl.professional_tax,
            spl.tds, spl.lwp_deduction, spl.advance_recovery, spl.present_days,
            spl.working_days, spl.lwp_days, spr.run_month, spr.status AS run_status
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ? AND spr.status <> 'draft'
      ORDER BY spr.run_month DESC LIMIT 1`,
    [employeeId],
  );
  return { row };
}

async function fetchLeave(employeeId: string): Promise<Record<string, unknown>> {
  const year = new Date().getFullYear();
  const rows = await queryRows(
    `SELECT lt.leave_name, lt.leave_code, lbl.allocated_days, lbl.used_days, lbl.adjusted_days
       FROM leave_balance_ledger lbl
       JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
      WHERE lbl.employee_id = ? AND lbl.balance_year = ?
      ORDER BY lt.leave_name`,
    [employeeId, year],
  );
  return { year, rows };
}

async function fetchAttendance(employeeId: string): Promise<Record<string, unknown>> {
  const row = await queryOne(
    `SELECT SUM(attendance_status = 'present') AS present_days,
            SUM(attendance_status = 'half_day') AS half_days,
            SUM(attendance_status = 'absent') AS absent_days,
            SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late_marks,
            SUM(COALESCE(lwp_value, 0)) AS lwp_days,
            ROUND(SUM(COALESCE(raw_minutes, 0)) / 60, 2) AS total_hours,
            COUNT(CASE WHEN attendance_status NOT IN ('holiday','week_off') THEN 1 END) AS working_days
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND record_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        AND record_date <= CURDATE()`,
    [employeeId],
  );
  return { month: new Date().toISOString().slice(0, 7), row };
}

async function fetchRoster(employeeId: string): Promise<Record<string, unknown>> {
  const rows = await queryRows(
    `SELECT DATE_FORMAT(rda.roster_date, '%Y-%m-%d') AS roster_date,
            st.shift_name, st.start_time, st.end_time,
            rda.is_week_off, rda.is_holiday, rda.acknowledgement_status
       FROM roster_daily_assignment rda
       JOIN weekly_roster_cycle c ON c.id = rda.cycle_id
       LEFT JOIN wfm_shift_template st ON st.id = rda.shift_template_id
      WHERE rda.employee_id = ?
        AND rda.roster_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        AND c.status IN ('published','acknowledged','active','attendance_locked','payroll_input_ready','closed')
      ORDER BY rda.roster_date`,
    [employeeId],
  );
  return { rows };
}

async function fetchDocuments(employeeId: string): Promise<Record<string, unknown>> {
  const rows = await queryRows(
    `SELECT doc_type, doc_name, verified, created_at
       FROM employee_documents
      WHERE employee_id = ?
      ORDER BY created_at DESC LIMIT 100`,
    [employeeId],
  );
  return { rows };
}

async function fetchPendingActions(userId: string, roleKeys: string[]): Promise<Record<string, unknown>> {
  const roles = roleKeys.length ? roleKeys : ['employee'];
  const placeholders = roles.map(() => '?').join(',');
  const rows = await queryRows(
    `SELECT item_type, title, module_code, priority, status, due_at
       FROM work_item
      WHERE (assigned_to_user_id = ? OR assigned_to_role IN (${placeholders}))
        AND status NOT IN ('completed','cancelled')
      ORDER BY FIELD(priority,'critical','high','medium','low'), due_at ASC
      LIMIT 12`,
    [userId, ...roles],
  );
  return { rows };
}

async function fetchSupport(employeeId: string): Promise<Record<string, unknown>> {
  const [tickets, grievances] = await Promise.all([
    queryRows(
      `SELECT ticket_code, category, subject, priority, status, sla_due_at, created_at
         FROM helpdesk_ticket WHERE employee_id = ? ORDER BY created_at DESC LIMIT 10`,
      [employeeId],
    ),
    queryRows(
      `SELECT category, severity, status, created_at, resolved_at
         FROM grievance
        WHERE employee_id = ? AND (is_anonymous = 0 OR is_anonymous IS NULL)
        ORDER BY created_at DESC LIMIT 10`,
      [employeeId],
    ),
  ]);
  return { tickets, grievances };
}

async function fetchPayrollReadiness(employeeId: string): Promise<Record<string, unknown>> {
  const row = await queryOne(
    `SELECT period_start, period_end, readiness_status, blocker_summary, confidence_score, scanned_at
       FROM payroll_readiness_snapshot
      WHERE employee_id = ? ORDER BY scanned_at DESC LIMIT 1`,
    [employeeId],
  );
  return { row };
}

async function fetchLoans(employeeId: string): Promise<Record<string, unknown>> {
  const rows = await queryRows(
    `SELECT loan_type, amount, deduction_per_month, deducted_amount, pending_amount,
            installments, start_date, end_date, status
       FROM employee_loans WHERE employee_id = ? ORDER BY created_at DESC LIMIT 10`,
    [employeeId],
  );
  return { rows };
}

async function fetchReimbursements(employeeId: string): Promise<Record<string, unknown>> {
  const rows = await queryRows(
    `SELECT claim_type, claim_month, amount_claimed, amount_approved, status,
            submitted_at, approved_at, rejection_reason, processed_at
       FROM employee_reimbursement_claim
      WHERE employee_id = ? ORDER BY created_at DESC LIMIT 10`,
    [employeeId],
  );
  return { rows };
}

async function fetchJourney(employeeId: string): Promise<Record<string, unknown>> {
  const rows = await queryRows(
    `SELECT event_type, event_date, description, module
       FROM employee_journey_log
      WHERE employee_id = ? ORDER BY event_date DESC, created_at DESC LIMIT 12`,
    [employeeId],
  );
  return { rows };
}

function helpAnswer(): string {
  return `${MIRA_NAME} can privately answer questions about your own HRMS account, including:\n\n` +
    `• profile, employee code, joining date, branch, process and reporting manager\n` +
    `• salary and payslip summary\n` +
    `• leave balances\n` +
    `• attendance, late marks, LWP and working hours\n` +
    `• roster, shift and week-off\n` +
    `• document verification status\n` +
    `• pending work items and approvals\n` +
    `• helpdesk tickets and grievances\n` +
    `• payroll readiness, loans and reimbursement claims\n\n` +
    `For privacy, ${MIRA_NAME} will not disclose another employee's personal account information in chat.`;
}

export function getMiraSuggestedPrompts(): string[] {
  return [
    'Give me my account summary',
    'Show my latest salary breakup',
    'How many leaves do I have left?',
    'Summarize my attendance this month',
    'What is my shift for the next 7 days?',
    'Which documents are pending verification?',
    'What actions are pending from my side?',
    'Show my loan or reimbursement status',
  ];
}

export async function answerSelfAccountQuestion(
  question: string,
  userId: string,
  roleKeys: string[],
): Promise<AccountAnswerResult> {
  const startedAt = Date.now();
  const intent = detectIntent(question);
  if (intent === 'unknown') return { handled: false, intent };

  if (intent === 'scope_violation') {
    return {
      handled: true,
      intent,
      response: localResponse(
        intent,
        `I can only discuss your own account in this chat. I will not reveal another employee's salary, attendance, leave, documents, profile, or other personal HR information. Authorised business users should use the relevant scoped HRMS dashboard instead.`,
        startedAt,
        [{ key: 'privacy-protected', label: 'Other employee data blocked', severity: 'low' }],
      ),
    };
  }

  if (intent === 'help') {
    return { handled: true, intent, response: localResponse(intent, helpAnswer(), startedAt, [], [dashboardAction()]) };
  }

  const employee = await getEmployeeForUser(userId);
  if (!employee?.id) {
    return {
      handled: true,
      intent,
      response: localResponse(intent, 'Your login is not linked to an active employee record. Please contact HR or the HRMS administrator to correct the user-to-employee mapping.', startedAt, [
        { key: 'employee-map-missing', label: 'Employee mapping missing', severity: 'high' },
      ], [], 0.25),
    };
  }

  if (intent === 'profile') {
    const { row } = await cached(userId, intent, () => fetchProfile(employee.id)) as { row: RowDataPacket };
    if (!row?.employee_code) return { handled: true, intent, response: localResponse(intent, 'Your profile record could not be loaded right now.', startedAt, [], [], 0.3) };
    const answer = `Here are your current profile details:\n\n` +
      `• Name: ${textValue(row.full_name)}\n` +
      `• Employee code: ${textValue(row.employee_code)}\n` +
      `• Joining date: ${formatDate(row.date_of_joining)}\n` +
      `• Employment status: ${textValue(row.employment_status)}\n` +
      `• Employment type: ${textValue(row.employment_type)}\n` +
      `• Branch: ${textValue(row.branch_name)}\n` +
      `• Process: ${textValue(row.process_name)}\n` +
      `• Reporting manager: ${textValue(row.reporting_manager_name)}`;
    return { handled: true, intent, response: localResponse(intent, answer, startedAt, [], [dashboardAction('Open my profile dashboard')]) };
  }

  if (intent === 'salary') {
    const { row } = await cached(userId, intent, () => fetchSalary(employee.id)) as { row: RowDataPacket };
    if (!row?.run_month) return { handled: true, intent, response: localResponse(intent, 'No finalized payslip or salary preparation record is available for your account yet.', startedAt, [], [dashboardAction()], 0.5) };
    const answer = `Your latest finalized salary summary for ${textValue(row.run_month)} is:\n\n` +
      `• Gross earnings: ${formatCurrency(row.gross_salary)}\n` +
      `• Total deductions: ${formatCurrency(row.total_deductions)}\n` +
      `• Net take-home: ${formatCurrency(row.net_salary)}\n` +
      `• Basic: ${formatCurrency(row.basic)}\n` +
      `• HRA: ${formatCurrency(row.hra)}\n` +
      `• Special allowance: ${formatCurrency(row.special_allowance)}\n` +
      `• PF: ${formatCurrency(row.pf_employee)}\n` +
      `• ESIC: ${formatCurrency(row.esic_employee)}\n` +
      `• Professional tax: ${formatCurrency(row.professional_tax)}\n` +
      `• TDS: ${formatCurrency(row.tds)}\n` +
      `• LWP deduction: ${formatCurrency(row.lwp_deduction)}\n` +
      `• Advance recovery: ${formatCurrency(row.advance_recovery)}\n` +
      `• Present / working days: ${numberValue(row.present_days)} / ${numberValue(row.working_days)}`;
    return { handled: true, intent, response: localResponse(intent, answer, startedAt, [
      { key: 'net-pay', label: 'Net take-home', value: numberValue(row.net_salary), severity: 'low' },
    ], [dashboardAction('Open payroll dashboard')]) };
  }

  if (intent === 'leave') {
    const { year, rows } = await cached(userId, intent, () => fetchLeave(employee.id)) as { year: number; rows: RowDataPacket[] };
    if (!rows.length) return { handled: true, intent, response: localResponse(intent, `No leave balance ledger is available for ${year}. Please check with HR if allocation should already be visible.`, startedAt, [], [dashboardAction()], 0.5) };
    const lines = rows.map((row) => {
      const available = Math.max(0, numberValue(row.allocated_days) + numberValue(row.adjusted_days) - numberValue(row.used_days));
      return `• ${textValue(row.leave_name)} (${textValue(row.leave_code)}): ${available} available, ${numberValue(row.used_days)} used, ${numberValue(row.allocated_days)} allocated`;
    });
    return { handled: true, intent, response: localResponse(intent, `Your ${year} leave balances are:\n\n${lines.join('\n')}`, startedAt, [
      { key: 'leave-types', label: `${rows.length} leave types found`, count: rows.length, severity: 'low' },
    ], [dashboardAction('Open leave dashboard')]) };
  }

  if (intent === 'attendance') {
    const { month, row } = await cached(userId, intent, () => fetchAttendance(employee.id)) as { month: string; row: RowDataPacket };
    const workingDays = numberValue(row.working_days);
    const presentEquivalent = numberValue(row.present_days) + (numberValue(row.half_days) * 0.5);
    const percentage = workingDays > 0 ? Math.round((presentEquivalent / workingDays) * 1000) / 10 : 0;
    const answer = `Your attendance summary for ${month} is:\n\n` +
      `• Present days: ${numberValue(row.present_days)}\n` +
      `• Half days: ${numberValue(row.half_days)}\n` +
      `• Absent days: ${numberValue(row.absent_days)}\n` +
      `• Late marks: ${numberValue(row.late_marks)}\n` +
      `• LWP days: ${numberValue(row.lwp_days)}\n` +
      `• Hours logged: ${numberValue(row.total_hours)}\n` +
      `• Attendance percentage: ${percentage}%`;
    return { handled: true, intent, response: localResponse(intent, answer, startedAt, [
      { key: 'attendance-percent', label: `${percentage}% attendance`, value: percentage, severity: percentage < 85 ? 'high' : percentage < 95 ? 'medium' : 'low' },
    ], [{ key: 'attendance', label: 'Open attendance', url: '/attendance', priority: 'low' }]) };
  }

  if (intent === 'roster') {
    const { rows } = await cached(userId, intent, () => fetchRoster(employee.id)) as { rows: RowDataPacket[] };
    if (!rows.length) return { handled: true, intent, response: localResponse(intent, 'No published roster is available for your account for the next 7 days.', startedAt, [], [dashboardAction()], 0.5) };
    const lines = rows.map((row) => {
      if (numberValue(row.is_week_off) === 1) return `• ${formatDate(row.roster_date)}: Week off`;
      if (numberValue(row.is_holiday) === 1) return `• ${formatDate(row.roster_date)}: Holiday`;
      return `• ${formatDate(row.roster_date)}: ${textValue(row.shift_name, 'Shift')} (${textValue(row.start_time, '--')}–${textValue(row.end_time, '--')})`;
    });
    return { handled: true, intent, response: localResponse(intent, `Your published roster for the next 7 days:\n\n${lines.join('\n')}`, startedAt, [], [dashboardAction('Open roster dashboard')]) };
  }

  if (intent === 'documents') {
    const { rows } = await cached(userId, intent, () => fetchDocuments(employee.id)) as { rows: RowDataPacket[] };
    if (!rows.length) return { handled: true, intent, response: localResponse(intent, 'No employee document records are currently visible in your account.', startedAt, [], [dashboardAction()], 0.5) };
    const verified = rows.filter((row) => numberValue(row.verified) === 1).length;
    const pending = rows.filter((row) => numberValue(row.verified) !== 1);
    const pendingNames = pending.slice(0, 8).map((row) => textValue(row.doc_name, textValue(row.doc_type))).join(', ');
    const answer = `Your document status:\n\n• Total documents: ${rows.length}\n• Verified: ${verified}\n• Pending verification: ${pending.length}` +
      (pendingNames ? `\n• Pending items: ${pendingNames}` : '');
    return { handled: true, intent, response: localResponse(intent, answer, startedAt, [
      { key: 'pending-documents', label: `${pending.length} pending documents`, count: pending.length, severity: pending.length ? 'medium' : 'low' },
    ], [dashboardAction('Open document dashboard')]) };
  }

  if (intent === 'pending_actions') {
    const { rows } = await cached(userId, intent, () => fetchPendingActions(userId, roleKeys)) as { rows: RowDataPacket[] };
    if (!rows.length) return { handled: true, intent, response: localResponse(intent, 'You have no open work items or assigned approvals at the moment.', startedAt, [
      { key: 'pending-actions', label: 'No pending actions', count: 0, severity: 'low' },
    ], [dashboardAction()]) };
    const lines = rows.slice(0, 8).map((row) => `• [${textValue(row.priority, 'medium')}] ${textValue(row.title)}${row.due_at ? ` — due ${formatDate(row.due_at)}` : ''}`);
    return { handled: true, intent, response: localResponse(intent, `You have ${rows.length} open assigned item(s). The highest-priority items are:\n\n${lines.join('\n')}`, startedAt, [
      { key: 'pending-actions', label: `${rows.length} pending actions`, count: rows.length, severity: rows.some((row) => row.priority === 'critical') ? 'critical' : 'medium' },
    ], [dashboardAction('Open work dashboard')]) };
  }

  if (intent === 'support') {
    const { tickets, grievances } = await cached(userId, intent, () => fetchSupport(employee.id)) as { tickets: RowDataPacket[]; grievances: RowDataPacket[] };
    const openTickets = tickets.filter((row) => !['resolved', 'closed'].includes(String(row.status))).length;
    const openGrievances = grievances.filter((row) => !['resolved', 'closed'].includes(String(row.status))).length;
    const answer = `Your support status:\n\n• Helpdesk tickets: ${tickets.length} recent, ${openTickets} open\n• Grievances: ${grievances.length} recent, ${openGrievances} open` +
      (tickets[0] ? `\n• Latest ticket: ${textValue(tickets[0].subject)} — ${textValue(tickets[0].status)}` : '');
    return { handled: true, intent, response: localResponse(intent, answer, startedAt, [
      { key: 'open-support', label: `${openTickets + openGrievances} open support items`, count: openTickets + openGrievances, severity: openTickets + openGrievances ? 'medium' : 'low' },
    ], [dashboardAction()]) };
  }

  if (intent === 'payroll_readiness') {
    const { row } = await cached(userId, intent, () => fetchPayrollReadiness(employee.id)) as { row: RowDataPacket };
    if (!row?.readiness_status) return { handled: true, intent, response: localResponse(intent, 'No payroll readiness scan is available for your account yet.', startedAt, [], [dashboardAction()], 0.5) };
    const answer = `Your latest payroll readiness status is ${textValue(row.readiness_status)} for ${formatDate(row.period_start)} to ${formatDate(row.period_end)}.` +
      (row.blocker_summary ? `\n\nBlocker summary: ${textValue(row.blocker_summary)}` : '') +
      `\nLast scanned: ${formatDate(row.scanned_at)}`;
    const blocked = ['blocked', 'hold'].includes(String(row.readiness_status).toLowerCase());
    return { handled: true, intent, response: localResponse(intent, answer, startedAt, [
      { key: 'payroll-readiness', label: `Payroll ${textValue(row.readiness_status)}`, severity: blocked ? 'high' : 'low' },
    ], [dashboardAction('Open payroll dashboard')], numberValue(row.confidence_score) || 0.8) };
  }

  if (intent === 'loans') {
    const { rows } = await cached(userId, intent, () => fetchLoans(employee.id)) as { rows: RowDataPacket[] };
    if (!rows.length) return { handled: true, intent, response: localResponse(intent, 'No employee loan or salary advance record is linked to your account.', startedAt, [], [dashboardAction()]) };
    const pending = rows.reduce((sum, row) => sum + numberValue(row.pending_amount), 0);
    const lines = rows.slice(0, 5).map((row) => `• ${textValue(row.loan_type)}: ${textValue(row.status)}, pending ${formatCurrency(row.pending_amount)}, monthly deduction ${formatCurrency(row.deduction_per_month)}`);
    return { handled: true, intent, response: localResponse(intent, `Your loan/advance summary:\n\n${lines.join('\n')}\n\nTotal pending amount: ${formatCurrency(pending)}`, startedAt, [
      { key: 'loan-pending', label: 'Pending loan amount', value: pending, severity: pending > 0 ? 'medium' : 'low' },
    ], [dashboardAction('Open payroll dashboard')]) };
  }

  if (intent === 'reimbursements') {
    const { rows } = await cached(userId, intent, () => fetchReimbursements(employee.id)) as { rows: RowDataPacket[] };
    if (!rows.length) return { handled: true, intent, response: localResponse(intent, 'No reimbursement claims are linked to your account.', startedAt, [], [dashboardAction()]) };
    const lines = rows.slice(0, 8).map((row) => `• ${textValue(row.claim_type)} (${textValue(row.claim_month)}): ${textValue(row.status)}, claimed ${formatCurrency(row.amount_claimed)}${row.amount_approved != null ? `, approved ${formatCurrency(row.amount_approved)}` : ''}`);
    return { handled: true, intent, response: localResponse(intent, `Your recent reimbursement claims:\n\n${lines.join('\n')}`, startedAt, [
      { key: 'claims', label: `${rows.length} recent claims`, count: rows.length, severity: rows.some((row) => row.status === 'rejected') ? 'medium' : 'low' },
    ], [dashboardAction('Open reimbursement dashboard')]) };
  }

  if (intent === 'journey') {
    const { rows } = await cached(userId, intent, () => fetchJourney(employee.id)) as { rows: RowDataPacket[] };
    if (!rows.length) return { handled: true, intent, response: localResponse(intent, 'No employee journey events are available for your account yet.', startedAt, [], [dashboardAction()], 0.5) };
    const lines = rows.slice(0, 10).map((row) => `• ${formatDate(row.event_date)} — ${textValue(row.event_type)}${row.description ? `: ${textValue(row.description)}` : ''}`);
    return { handled: true, intent, response: localResponse(intent, `Your recent employee journey events:\n\n${lines.join('\n')}`, startedAt, [], [dashboardAction('Open my dashboard')]) };
  }

  if (intent === 'account_overview') {
    const [profile, attendance, leave, roster, pending] = await Promise.all([
      cached(userId, 'profile', () => fetchProfile(employee.id)),
      cached(userId, 'attendance', () => fetchAttendance(employee.id)),
      cached(userId, 'leave', () => fetchLeave(employee.id)),
      cached(userId, 'roster', () => fetchRoster(employee.id)),
      cached(userId, 'pending_actions', () => fetchPendingActions(userId, roleKeys)),
    ]);
    const p = (profile as { row: RowDataPacket }).row;
    const a = (attendance as { row: RowDataPacket }).row;
    const leaveRows = (leave as { rows: RowDataPacket[] }).rows;
    const rosterRows = (roster as { rows: RowDataPacket[] }).rows;
    const actionRows = (pending as { rows: RowDataPacket[] }).rows;
    const totalLeave = leaveRows.reduce((sum, row) => sum + Math.max(0, numberValue(row.allocated_days) + numberValue(row.adjusted_days) - numberValue(row.used_days)), 0);
    const nextShift = rosterRows[0];
    const answer = `Here is your current HRMS account summary:\n\n` +
      `• Employee: ${textValue(p?.full_name)} (${textValue(p?.employee_code)})\n` +
      `• Branch / process: ${textValue(p?.branch_name)} / ${textValue(p?.process_name)}\n` +
      `• This month's attendance: ${numberValue(a?.present_days)} present, ${numberValue(a?.absent_days)} absent, ${numberValue(a?.late_marks)} late marks\n` +
      `• Leave available: ${totalLeave} days across ${leaveRows.length} leave types\n` +
      `• Pending assigned actions: ${actionRows.length}\n` +
      `• Next roster entry: ${nextShift ? `${formatDate(nextShift.roster_date)} — ${numberValue(nextShift.is_week_off) ? 'Week off' : numberValue(nextShift.is_holiday) ? 'Holiday' : textValue(nextShift.shift_name, 'Shift')}` : 'Not published'}`;
    return { handled: true, intent, response: localResponse(intent, answer, startedAt, [
      { key: 'pending-actions', label: `${actionRows.length} pending actions`, count: actionRows.length, severity: actionRows.length ? 'medium' : 'low' },
      { key: 'leave-available', label: `${totalLeave} leave days available`, value: totalLeave, severity: 'low' },
    ], [dashboardAction()]) };
  }

  return { handled: false, intent: 'unknown' };
}
