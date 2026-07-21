# Task 1: Create `ai-intent.service.ts`

## Context
You are implementing Task 1 of 4 in the AI Copilot Real Data feature for MAS PeopleOS HRMS at `c:\Users\ADMIN\Desktop\HRMS2-latest`.

The problem: PeopleOS Copilot returns "Context analyzed. No immediate action items detected. All systems operating normally." for every question because the backend never fetches real HRMS data before calling the AI. This task creates the service that detects question intent and fetches the relevant data.

## Your job
Create ONE new file: `backend/src/modules/ai/ai-intent.service.ts`

## Complete file to write (copy exactly)

```typescript
import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { getEmployeeForUser } from '../../shared/accessGuard.js';

export type IntentKey =
  | 'salary_breakup'
  | 'leave_balance'
  | 'attendance_summary'
  | 'pending_actions'
  | 'unknown';

const INTENT_PATTERNS: Array<{ intent: IntentKey; keywords: string[] }> = [
  {
    intent: 'salary_breakup',
    keywords: ['salary', 'payslip', 'breakup', 'ctc', 'pay slip', 'earnings',
               'deduction', 'take home', 'net pay', 'gross', 'in hand',
               'salary slip', 'my pay', 'how much i earn'],
  },
  {
    intent: 'leave_balance',
    keywords: ['leave balance', 'leave remaining', 'how many leaves', 'leave left',
               'pl balance', 'el balance', 'cl balance', 'sick leave', 'casual leave',
               'privilege leave', 'annual leave', 'my leaves', 'leave available'],
  },
  {
    intent: 'attendance_summary',
    keywords: ['attendance', 'present', 'absent', 'late', 'punch', 'clocked',
               'how many days', 'attendance percentage', 'late marks', 'lwp',
               'leave without pay', 'attendance this month', 'my attendance'],
  },
  {
    intent: 'pending_actions',
    keywords: ['pending', 'pending approval', 'pending requests', 'action',
               'my inbox', 'work inbox', 'approvals', 'what is pending'],
  },
];

export function detectIntent(question: string): IntentKey {
  const q = question.toLowerCase();
  for (const { intent, keywords } of INTENT_PATTERNS) {
    if (keywords.some((kw) => q.includes(kw))) return intent;
  }
  return 'unknown';
}

async function fetchSalaryBreakup(
  employeeId: string,
  db: Pool
): Promise<Record<string, unknown>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       spl.gross_salary, spl.total_deductions, spl.net_salary,
       spl.basic, spl.hra, spl.special_allowance,
       spl.pf_employee, spl.esic_employee, spl.professional_tax, spl.tds,
       spl.lwp_deduction, spl.advance_recovery,
       spl.present_days, spl.working_days, spl.lwp_days,
       spr.run_month
     FROM salary_prep_line spl
     JOIN salary_prep_run spr ON spr.id = spl.run_id
     WHERE spl.employee_id = ?
       AND spr.status != 'draft'
     ORDER BY spr.run_month DESC
     LIMIT 1`,
    [employeeId]
  );
  if (!rows.length) return { salary_data_available: false };
  const r = rows[0];
  return {
    salary_data_available: true,
    salary_month: r.run_month,
    earnings_total: Number(r.gross_salary ?? 0),
    deductions_total: Number(r.total_deductions ?? 0),
    take_home_amount: Number(r.net_salary ?? 0),
    basic_component: Number(r.basic ?? 0),
    hra_component: Number(r.hra ?? 0),
    special_allowance_component: Number(r.special_allowance ?? 0),
    pf_deduction: Number(r.pf_employee ?? 0),
    esic_deduction: Number(r.esic_employee ?? 0),
    professional_tax_deduction: Number(r.professional_tax ?? 0),
    tds_deduction: Number(r.tds ?? 0),
    lwp_deduction: Number(r.lwp_deduction ?? 0),
    advance_recovery: Number(r.advance_recovery ?? 0),
    present_days_count: Number(r.present_days ?? 0),
    working_days_count: Number(r.working_days ?? 0),
    lwp_days_count: Number(r.lwp_days ?? 0),
  };
}

async function fetchLeaveBalance(
  employeeId: string,
  db: Pool
): Promise<Record<string, unknown>> {
  const year = new Date().getFullYear();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lbl.allocated_days, lbl.used_days, lbl.adjusted_days,
            lt.leave_name, lt.leave_code
     FROM leave_balance_ledger lbl
     JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
     WHERE lbl.employee_id = ? AND lbl.balance_year = ?
     ORDER BY lt.leave_name ASC`,
    [employeeId, year]
  );
  if (!rows.length) return { leave_data_available: false };
  const balances = rows.map((r) => ({
    name: r.leave_name as string,
    code: r.leave_code as string,
    allocated: Number(r.allocated_days ?? 0),
    used: Number(r.used_days ?? 0),
    available: Math.max(
      0,
      Number(r.allocated_days ?? 0) +
      Number(r.adjusted_days ?? 0) -
      Number(r.used_days ?? 0)
    ),
  }));
  return {
    leave_data_available: true,
    leave_year: year,
    leave_balances: balances,
    total_available_leaves: balances.reduce((s, b) => s + b.available, 0),
  };
}

async function fetchAttendanceSummary(
  employeeId: string,
  db: Pool
): Promise<Record<string, unknown>> {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(status = 'present') AS present_days,
       SUM(status = 'half_day') AS half_days,
       SUM(status = 'absent') AS absent_days,
       SUM(status = 'late') AS late_days,
       SUM(status = 'leave_approved') AS leave_days,
       SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late_marks,
       SUM(COALESCE(lwp_value, 0)) AS total_lwp,
       ROUND(SUM(COALESCE(raw_minutes, 0)) / 60, 2) AS total_hours,
       COUNT(CASE WHEN status NOT IN ('holiday','week_off') THEN 1 END) AS working_days
     FROM attendance_daily_record
     WHERE employee_id = ?
       AND DATE_FORMAT(record_date, '%Y-%m') = ?
       AND record_date <= CURDATE()`,
    [employeeId, currentMonth]
  );
  if (!rows.length) return { attendance_data_available: false };
  const r = rows[0];
  const presentDays = Number(r.present_days ?? 0);
  const workingDays = Number(r.working_days ?? 1);
  const attPct = workingDays > 0 ? Math.round((presentDays / workingDays) * 1000) / 10 : 0;
  return {
    attendance_data_available: true,
    attendance_month: currentMonth,
    present_days_att: presentDays,
    absent_days_att: Number(r.absent_days ?? 0),
    half_days_att: Number(r.half_days ?? 0),
    late_days_att: Number(r.late_days ?? 0),
    late_marks_count: Number(r.late_marks ?? 0),
    lwp_total: Number(r.total_lwp ?? 0),
    working_days_att: workingDays,
    attendance_percentage: attPct,
    total_hours_logged: Number(r.total_hours ?? 0),
  };
}

export async function detectAndEnrich(
  question: string,
  userId: string,
  db: Pool
): Promise<{ intent: IntentKey; data: Record<string, unknown> }> {
  const intent = detectIntent(question);
  if (intent === 'unknown') return { intent, data: {} };

  const emp = await getEmployeeForUser(userId);
  if (!emp) return { intent, data: { employee_not_found: true } };

  let data: Record<string, unknown> = {};
  try {
    switch (intent) {
      case 'salary_breakup':
        data = await fetchSalaryBreakup(emp.id, db);
        break;
      case 'leave_balance':
        data = await fetchLeaveBalance(emp.id, db);
        break;
      case 'attendance_summary':
        data = await fetchAttendanceSummary(emp.id, db);
        break;
      case 'pending_actions':
        data = { pending_actions_hint: true };
        break;
    }
  } catch {
    data = { data_fetch_error: true };
  }

  return { intent, data };
}
```

## Global Constraints
- No `any` — all types explicit (`RowDataPacket` from `mysql2`, `Pool` from `mysql2/promise`)
- Import extension must be `.js` (ESM): `from '../../shared/accessGuard.js'`
- `getEmployeeForUser` returns `{ id: string; employee_code: string } | null` — use `.id` for DB queries
- Safe field aliases for salary (avoids PII redaction layer): `earnings_total`, `take_home_amount`, `deductions_total`, `basic_component`, `hra_component` — NOT `gross_salary`, `net_salary`, `basic`, etc.
- All DB fetchers return `Record<string, unknown>` — the caller merges into rawContext
- `detectAndEnrich` is non-blocking by design — it catches and returns `{ data_fetch_error: true }` on error

## Steps
1. Write the file exactly as shown above to `backend/src/modules/ai/ai-intent.service.ts`
2. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend && npx tsc --noEmit` — fix any TypeScript errors
3. Commit: `git add backend/src/modules/ai/ai-intent.service.ts && git commit -m "feat(ai): add intent detection + HRMS data enrichment service"`

## Report file
Write report to: `c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ai-copilot-task-1-report.md`

Include: Status, commit hash, TypeScript result, concerns.
Return ONLY: status word, commit hash, one-line test summary, concerns.
