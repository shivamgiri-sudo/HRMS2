/**
 * Provisioning Retry Background Job
 *
 * Retries failed provisioning task dispatch for employees
 * where provisioning was not dispatched on creation.
 *
 * Schedule: Every hour
 */

import { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import { dispatchJoinProvisioningTasks } from '../modules/it-provisioning/it-provisioning.service.js';

export interface RetryReport {
  attempted: number;
  succeeded: number;
  failed: Array<{ employeeId: string; employeeCode: string; error: string }>;
  runAt: string;
}

export async function runProvisioningRetryJob(): Promise<RetryReport> {
  const report: RetryReport = {
    attempted: 0,
    succeeded: 0,
    failed: [],
    runAt: new Date().toISOString(),
  };

  // Find employees with no provisioning tasks dispatched
  const [employees] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT
       e.id,
       e.employee_code,
       e.first_name,
       e.date_of_joining,
       e.branch_id,
       ob.id AS bridge_id
     FROM employees e
     JOIN ats_onboarding_bridge ob ON ob.employee_id = e.id
     WHERE e.active_status = 0
       AND e.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       -- Match on task_code. request_type is ENUM('join','exit'); comparing it
       -- to a task code never matches, so NOT EXISTS was always true and this
       -- job re-dispatched every eligible employee on every run — hourly, plus
       -- once on boot. It has not bitten yet only because no employee has ever
       -- been created through the ATS path for it to select; that changes as
       -- soon as conversion works, and createRequest has no idempotency key.
       AND NOT EXISTS (
         SELECT 1 FROM it_provisioning_request pr
         WHERE pr.employee_id = e.id
           AND pr.task_code = 'IT_EMAIL_DOMAIN_ASSET'
       )
     LIMIT 50`,
    []
  );

  for (const emp of employees as any[]) {
    report.attempted++;
    try {
      await dispatchJoinProvisioningTasks({
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.first_name,
        branchId: emp.branch_id,
        actorUserId: 'system_retry',
        triggerEventId: emp.bridge_id ?? null,
        joiningDate: emp.date_of_joining,
      });
      report.succeeded++;
      console.log(`[ProvisioningRetry] Dispatched for ${emp.employee_code}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.failed.push({ employeeId: emp.id, employeeCode: emp.employee_code, error: msg });
      console.error(`[ProvisioningRetry] Failed for ${emp.employee_code}:`, msg);
    }
  }

  return report;
}
