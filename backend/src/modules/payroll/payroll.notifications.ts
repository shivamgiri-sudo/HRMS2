/**
 * Payroll notifications — the strictest group on the gateway.
 *
 * Payroll is where a wrong recipient stops being a bug and becomes a data-leak incident,
 * so the rules are enforced by the resolver rather than trusted to this file:
 *
 *  - every payroll event is sensitivity='fin', which forces the recipient to
 *    employees.official_email on an allowed company domain. There is no personal-address
 *    fallback except for full_final_ready, where the employee has left and the official
 *    mailbox is disabled — a single documented exception.
 *  - a 'fin' event about an employee that names ANY cc/bcc is a hard error. payslip_ready
 *    therefore cannot copy a manager even if someone later edits the registry to try.
 *
 * Fire-and-forget throughout: locking a payroll run must never fail because a mail server
 * is down. Nothing sends today — every payroll event ships enabled=0,
 * dispatch_mode='shadow' (migration 1022).
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { notificationGateway } from '../communication/notification.gateway.js';

/** Run status -> catalogue event. Statuses with no notification return null. */
const RUN_EVENT: Record<string, string | null> = {
  draft: null,
  calculating: null,
  calculated: 'payroll_run_calculated',
  under_review: 'payroll_run_under_review',
  approved: 'payroll_run_approved',
  locked: 'payroll_run_locked',
  disbursed: null,   // disbursed fans out to payslip_ready per employee instead
  cancelled: null,
};

interface RunRow extends RowDataPacket {
  id: string;
  run_month: string;
  branch_id: string | null;
  total_employees: number | null;
  total_gross: number | null;
  total_deductions: number | null;
  total_net: number | null;
}

async function loadRun(runId: string): Promise<RunRow | null> {
  const [rows] = await db.execute<RunRow[]>(
    `SELECT id, run_month, branch_id, total_employees, total_gross, total_deductions, total_net
       FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [runId],
  );
  return rows[0] ?? null;
}

/**
 * Prior run for the same branch, for the variance figure.
 *
 * Returns null when there is no comparable prior run — a first run for a new branch has
 * no variance, and inventing 0% or 100% would be worse than showing nothing.
 */
async function priorRunTotals(run: RunRow): Promise<{ net: number | null; month: string | null }> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT run_month, total_net
         FROM salary_prep_run
        WHERE run_month < ?
          AND (branch_id <=> ?)
          AND status IN ('approved','locked','disbursed')
        ORDER BY run_month DESC
        LIMIT 1`,
      [run.run_month, run.branch_id],
    );
    if (!rows.length || rows[0].total_net == null) return { net: null, month: null };
    return { net: Number(rows[0].total_net), month: String(rows[0].run_month) };
  } catch {
    return { net: null, month: null };
  }
}

/**
 * Payroll run reached a notifiable status.
 *
 * The CEO copy on payroll_run_approved is conditional on the run's net total exceeding
 * the seeded threshold (sql/403 sets ₹50,00,000). The threshold is evaluated by the
 * resolver against `vars.amount`, so it stays a recipient rule rather than being
 * hard-coded into a notification body.
 */
export async function notifyPayrollRunStatus(runId: string, newStatus: string): Promise<void> {
  const eventCode = RUN_EVENT[newStatus] ?? null;
  if (!eventCode) return;
  try {
    const run = await loadRun(runId);
    if (!run) return;
    const prior = await priorRunTotals(run);
    const net = run.total_net == null ? null : Number(run.total_net);

    await notificationGateway.notify({
      eventCode,
      dedupeKey: `salary_prep_run:${runId}:${newStatus}`,
      context: {
        branchId: run.branch_id,
        // Drives the conditional CEO copy on payroll_run_approved.
        vars: { amount: net ?? 0 },
      },
      entityType: 'salary_prep_run',
      entityId: runId,
      correlationId: `payroll_run:${runId}`,
      data: {
        run_month: run.run_month,
        status: newStatus,
        // analytics strip (catalogue 6.4): headcount · gross · variance vs prior run
        headcount: run.total_employees == null ? null : Number(run.total_employees),
        total_gross: run.total_gross == null ? null : Number(run.total_gross),
        total_deductions: run.total_deductions == null ? null : Number(run.total_deductions),
        total_net: net,
        prior_month: prior.month,
        // Null, not 0, when there is no comparable prior run.
        variance_vs_prior: prior.net == null || net == null ? null : Math.round((net - prior.net) * 100) / 100,
      },
    });
  } catch (err) {
    console.error(`[payroll-notify] run ${runId} -> ${newStatus}:`, (err as Error).message);
  }
}

interface PayslipRow extends RowDataPacket {
  employee_id: string;
  employee_code: string | null;
  net_salary: number | null;
  gross_salary: number | null;
  lwp_days: number | null;
  branch_id: string | null;
}

/**
 * Payslip availability, one notification per employee.
 *
 * NOTE ON VOLUME: a full run is ~1,200 employees. The gateway's per-event daily cap
 * (max_per_day, default 500 from migration 1022) will throttle this and report the
 * remainder rather than dropping it silently. Raise the cap for payslip_ready
 * deliberately before switching it live, and expect the run to span more than one day at
 * the default.
 *
 * ALSO: 156 of 1,152 active employees have no official email (measured 2026-07-31), and
 * `fin` sensitivity means they are DROPPED rather than fallen back to a personal address.
 * Those drops are recorded with a reason on the claim, and the undeliverable-recipients
 * report is what turns them into an HR data task.
 */
export async function notifyPayslipsReady(runId: string): Promise<{ employees: number; notified: number; skipped: number }> {
  const result = { employees: 0, notified: 0, skipped: 0 };
  try {
    const run = await loadRun(runId);
    if (!run) return result;

    const [lines] = await db.execute<PayslipRow[]>(
      `SELECT spl.employee_id, spl.employee_code, spl.net_salary, spl.gross_salary, spl.lwp_days,
              e.branch_id
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id AND e.active_status = 1
        WHERE spl.run_id = ?
        ORDER BY spl.employee_code`,
      [runId],
    );
    result.employees = lines.length;

    for (const line of lines) {
      try {
        const outcome = await notificationGateway.notify({
          eventCode: 'payslip_ready',
          dedupeKey: `salary_prep_run:${runId}:payslip:${line.employee_id}`,
          context: { employeeId: line.employee_id, branchId: line.branch_id },
          entityType: 'salary_prep_run',
          entityId: runId,
          correlationId: `payroll_run:${runId}`,
          data: {
            run_month: run.run_month,
            employee_code: line.employee_code,
            // analytics strip (catalogue 6.4): net · LOP days
            net_pay: line.net_salary == null ? null : Number(line.net_salary),
            gross_pay: line.gross_salary == null ? null : Number(line.gross_salary),
            lop_days: line.lwp_days == null ? null : Number(line.lwp_days),
          },
        });
        if (outcome.outcome === 'sent' || outcome.outcome === 'shadow') result.notified++;
        else result.skipped++;
      } catch (err) {
        // One employee failing must not stop the rest of the payroll being notified.
        result.skipped++;
        console.error(`[payroll-notify] payslip ${runId}/${line.employee_id}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error(`[payroll-notify] payslips ${runId}:`, (err as Error).message);
  }
  return result;
}
