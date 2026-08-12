/**
 * Employee Activation Service
 *
 * Automatic employee activation on joining date (no manual trigger needed)
 *
 * Two triggers (Option C - Hybrid):
 * 1. Real-time: When offer is approved and date_of_joining = TODAY
 * 2. Daily cron: 12:01 AM - activates employees whose joining date has been reached
 *
 * Governance:
 * - IT/Admin/WFM tasks must complete within 24h of joining (SLA tracking)
 * - These are NOT blockers for activation
 * - Dashboard shows SLA compliance violations
 */

import { RowDataPacket } from 'mysql2';
import { nonReactivatableSqlList } from "../exit/exitEmploymentStatus.js";
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { sendSMS } from '../communication/sms.helper.js';

export interface ActivationResult {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  joiningDate: string;
  activatedAt: string;
  slaWarnings: string[];
}

export interface ActivationReport {
  activated: ActivationResult[];
  alreadyActive: number;
  errors: Array<{ employeeId: string; error: string }>;
  slaViolations: SlaViolation[];
  runAt: string;
}

export interface SlaViolation {
  employeeId: string;
  employeeCode: string;
  taskCode: string;
  taskName: string;
  joiningDate: string;
  slaDeadline: string;
  hoursOverdue: number;
}

/**
 * Activate a single employee on joining date
 * Called real-time when offer is approved and joining date = today
 */
export async function activateEmployee(
  employeeId: string,
  actorUserId: string | null,
  reason: string = 'Joining date reached'
): Promise<{ activated: boolean; alreadyActive: boolean }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT active_status, employment_status, date_of_joining, employee_code
     FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );

  if (rows.length === 0) {
    throw new Error(`Employee ${employeeId} not found`);
  }

  const emp = rows[0] as any;

  if (emp.active_status === 1) {
    return { activated: false, alreadyActive: true };
  }

  // Activate
  await db.execute(
    `UPDATE employees
     SET active_status = 1, employment_status = 'Active', updated_at = NOW()
     WHERE id = ?`,
    [employeeId]
  );

  // Write lifecycle event.
  //
  // Every column this named was wrong, and the whole statement therefore threw
  // ER_BAD_FIELD_ERROR on every activation: employee_lifecycle_event has no
  // from_status, no to_status and no actor_user_id. It carries old_value_json,
  // new_value_json and initiated_by. event_type is an ENUM that has no
  // 'ACTIVATION' member either - an activation is a 'status_change'.
  //
  // The UPDATE above commits first and there is no transaction around the two,
  // so an employee was left correctly activated while activateEmployee() threw:
  // the daily job counted them as an error rather than as activated, and the
  // "HRMS access created" SMS below was never reached. The table has 0 rows,
  // which is the whole history of this feature.
  await db.execute(
    `INSERT INTO employee_lifecycle_event
       (id, employee_id, event_type, effective_date, old_value_json, new_value_json, initiated_by, remarks)
     VALUES (?, ?, 'status_change', CURDATE(), ?, ?, ?, ?)`,
    [
      randomUUID(),
      employeeId,
      JSON.stringify({
        employment_status: emp.employment_status ?? null,
        active_status: 0,
      }),
      JSON.stringify({ employment_status: 'Active', active_status: 1 }),
      actorUserId ?? 'system',
      reason,
    ]
  );

  // SMS — HRMS access created / employee activated (fire-and-forget)
  try {
    const [empRow] = await db.execute<RowDataPacket[]>(
      `SELECT CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, mobile, personal_phone
       FROM employees WHERE id = ? LIMIT 1`, [employeeId]
    );
    const e = (empRow[0] as any);
    const phone = e?.mobile ?? e?.personal_phone ?? null;
    if (phone) sendSMS(phone, 'hrms_access_created', { name: e.name }).catch(() => {});
  } catch { /* non-fatal */ }

  return { activated: true, alreadyActive: false };
}

/**
 * Daily cron job - activates all employees whose joining date has arrived
 * Called at 12:01 AM daily
 */
export async function runDailyActivationJob(): Promise<ActivationReport> {
  const runAt = new Date().toISOString();
  const report: ActivationReport = {
    activated: [],
    alreadyActive: 0,
    errors: [],
    slaViolations: [],
    runAt,
  };

  // Find all employees due for activation
  const [dueEmployees] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
       e.date_of_joining,
       e.employment_status
     FROM employees e
     -- Excludes leavers rather than listing the states that may activate.
     --
     -- The whitelist never matched anything: employees.employment_status is
     -- VARCHAR(50) DEFAULT 'Active' (migration 501's ENUM conversion is guarded
     -- by IF column_exists = 0 and is always skipped, because 002 created the
     -- column first), and the creation paths did not set it. A future-dated
     -- joiner was therefore stranded at active_status = 0 indefinitely, unable
     -- to log in and invisible to payroll and rosters.
     --
     -- Inverting the test makes activation independent of which path created
     -- the employee. Measured on live data: the whitelist selects 0, a naive
     -- blacklist would select 57,308 — every ex-employee, since active_status = 0
     -- overwhelmingly means "left" — and this form selects 0 today, admitting
     -- only genuine pre-joiners once they exist.
     WHERE e.active_status = 0
       AND LOWER(COALESCE(e.employment_status, '')) NOT IN
           (${nonReactivatableSqlList()})
       AND e.date_of_joining <= CURDATE()
       -- This job grants login access and had no notion of approval: it could
       -- not tell a first activation from a re-activation. Deactivation is
       -- governed (a stated reason, and coming back needs branch-head approval
       -- plus HR confirmation via /employees/reactivation), but that guard only
       -- refuses setting the label to 'Active'. Setting a deactivated employee
       -- to 'Onboarding' or 'On Notice' — neither excluded above — handed their
       -- access back that night with nobody approving it.
       --
       -- EMPLOYEE_DEACTIVATED is written by both deactivation paths
       -- (employee.service deactivateEmployee, and updateEmployee when it
       -- clears active_status). Anyone carrying one had access taken away
       -- deliberately and must return through the reactivation flow, not by
       -- being relabelled.
       --
       -- Known limit, accepted 2026-08-11: the marker only exists for
       -- deactivations recorded from that date onward, so historical leavers
       -- remain reachable this way. Measured before shipping — 0 employees
       -- carried the marker, and the ten pre-joiners due for activation that
       -- night were confirmed unaffected.
       AND NOT EXISTS (
         SELECT 1 FROM sensitive_action_log sal
          WHERE sal.employee_id = e.id
            AND sal.action_type = 'EMPLOYEE_DEACTIVATED'
       )`,
    []
  );

  for (const emp of dueEmployees as any[]) {
    try {
      const result = await activateEmployee(
        emp.id,
        null,
        `Auto-activated by daily job on ${new Date().toISOString()}`
      );

      if (result.activated) {
        const slaWarnings = await checkProvisioningSlaWarnings(emp.id);

        report.activated.push({
          employeeId: emp.id,
          employeeCode: emp.employee_code,
          employeeName: emp.full_name,
          joiningDate: emp.date_of_joining,
          activatedAt: new Date().toISOString(),
          slaWarnings,
        });
      } else {
        report.alreadyActive++;
      }
    } catch (err) {
      report.errors.push({
        employeeId: emp.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Find SLA violations (tasks overdue > 24h past joining date)
  report.slaViolations = await findSlaViolations();

  return report;
}

/**
 * Check provisioning SLA warnings for a newly activated employee
 */
async function checkProvisioningSlaWarnings(employeeId: string): Promise<string[]> {
  const warnings: string[] = [];

  const [tasks] = await db.execute<RowDataPacket[]>(
    `SELECT
       request_type, task_code, status, sla_due_at, assignment_exception
     FROM it_provisioning_request
     -- These are task codes. Matching them against request_type — ENUM('join',
     -- 'exit') — returned nothing, so the per-employee SLA warnings were always
     -- empty and an employee could be activated with no email, no biometric and
     -- no ID card while the activation record asserted nothing was outstanding.
     WHERE employee_id = ?
       AND task_code IN ('WFM_PROCESS_ALIGNMENT', 'IT_EMAIL_DOMAIN_ASSET',
                         'ADMIN_BIOMETRIC_ID_CARD', 'APPOINTMENT_LETTER_ESIGN')`,
    [employeeId]
  );

  for (const task of tasks as any[]) {
    if (['pending', 'pending_unassigned', 'assigned'].includes(task.status)) {
      if (task.assignment_exception) {
        warnings.push(`${task.task_code}: No users assigned - admin action required`);
      } else {
        warnings.push(`${task.task_code}: Pending - 24h SLA clock started`);
      }
    }
  }

  return warnings;
}

/**
 * Find all provisioning tasks that have exceeded the 24h SLA
 */
export async function findSlaViolations(): Promise<SlaViolation[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       r.employee_id,
       e.employee_code,
       r.task_code,
       r.request_type,
       e.date_of_joining,
       r.sla_due_at,
       TIMESTAMPDIFF(HOUR, r.sla_due_at, NOW()) AS hours_overdue
     FROM it_provisioning_request r
     JOIN employees e ON e.id = r.employee_id
     WHERE r.sla_due_at IS NOT NULL
       AND r.sla_due_at < NOW()
       AND r.status IN ('pending', 'pending_unassigned', 'assigned', 'in_progress')
       AND e.active_status = 1
     ORDER BY hours_overdue DESC`,
    []
  );

  const taskNames: Record<string, string> = {
    IT_EMAIL_DOMAIN_ASSET: 'IT Email & Asset Setup',
    ADMIN_BIOMETRIC_ID_CARD: 'Admin Biometric & ID Card',
    WFM_PROCESS_ALIGNMENT: 'WFM Process & Roster Alignment',
    APPOINTMENT_LETTER_ESIGN: 'Appointment Letter E-Sign',
  };

  return (rows as any[]).map(r => ({
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    taskCode: r.task_code,
    taskName: taskNames[r.task_code] ?? r.task_code,
    joiningDate: r.date_of_joining,
    slaDeadline: r.sla_due_at,
    hoursOverdue: r.hours_overdue,
  }));
}

/**
 * Real-time activation check - called immediately after offer approval
 * If joining date is today or past, activate immediately
 */
export async function activateIfJoiningDateReached(
  employeeId: string,
  joiningDate: string,
  approverId: string
): Promise<boolean> {
  const joining = new Date(joiningDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  joining.setHours(0, 0, 0, 0);

  if (joining <= today) {
    const result = await activateEmployee(
      employeeId,
      approverId,
      'Immediate activation - joining date is today or past'
    );
    return result.activated;
  }

  return false; // Will be activated by cron on joining date
}
