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
       ob.offer_id
     FROM employees e
     JOIN ats_onboarding_bridge ob ON ob.employee_id = e.id
     WHERE e.active_status = 0
       AND e.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND NOT EXISTS (
         SELECT 1 FROM it_provisioning_request pr
         WHERE pr.employee_id = e.id
           AND pr.request_type = 'IT_EMAIL_DOMAIN_ASSET'
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
        triggerEventId: emp.offer_id ?? null,
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
