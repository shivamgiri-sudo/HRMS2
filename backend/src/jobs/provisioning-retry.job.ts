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
import { dispatchJoinProvisioningTasks, reresolveUnassignedRequests } from '../modules/it-provisioning/it-provisioning.service.js';
import { nonReactivatableSqlList } from '../modules/exit/exitEmploymentStatus.js';

export interface RetryReport {
  attempted: number;
  succeeded: number;
  failed: Array<{ employeeId: string; employeeCode: string; error: string }>;
  /** Requests recovered from pending_unassigned by the second pass. */
  reresolved: { scanned: number; assigned: number; stillUnassigned: number; remaining: number };
  runAt: string;
}

export async function runProvisioningRetryJob(): Promise<RetryReport> {
  const report: RetryReport = {
    attempted: 0,
    succeeded: 0,
    failed: [],
    reresolved: { scanned: 0, assigned: 0, stillUnassigned: 0, remaining: 0 },
    runAt: new Date().toISOString(),
  };

  // Find employees whose provisioning tasks were never dispatched.
  // - No bridge JOIN: direct-created employees must also be retried.
  // - 30-day window: 7 days was too short — a DB outage lasting a weekend
  //   would permanently skip any employee created during it.
  // - Checks IT_EMAIL_DOMAIN_ASSET task_code existence as the provisioning
  //   sentinel (the first task dispatched by dispatchJoinProvisioningTasks).
  // - active_status = 0 is overloaded: it means both "not-yet-active new
  //   joiner" (what this job is for) AND "legacy db_bill-migrated employee
  //   who has left" (migrate-legacy.employees.ts writes active_status = 0 for
  //   every departed legacy row). Removing the bridge JOIN above widened the
  //   match to include the second group too, and legacy-sync jobs re-touch
  //   employees.created_at on re-run, so long-exited legacy staff kept
  //   landing inside the 30-day window and getting fresh IT provisioning
  //   tasks auto-created for them. legacy_emp_id IS NULL plus the shared
  //   non-reactivatable employment_status guard (also used by the nightly
  //   activation job for the identical "don't act on someone who left"
  //   problem) excludes them without reverting the join/window fixes above.
  const [employees] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT
       e.id,
       e.employee_code,
       e.first_name,
       e.date_of_joining,
       e.branch_id,
       ob.id AS bridge_id
     FROM employees e
     LEFT JOIN ats_onboarding_bridge ob ON ob.employee_id = e.id
     WHERE e.active_status = 0
       AND e.legacy_emp_id IS NULL
       AND LOWER(COALESCE(e.employment_status, '')) NOT IN (${nonReactivatableSqlList()})
       AND e.employee_code IS NOT NULL
       AND e.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
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

  // Second pass: requests that WERE dispatched but landed with no owner.
  //
  // The loop above can never reach these — its NOT EXISTS clause skips any
  // employee that already has an IT_EMAIL_DOMAIN_ASSET row, and a
  // pending_unassigned request is exactly that: a row that exists and has no
  // assignee. Without this pass there is no path back for them at all, since the
  // tracker UI shows 'No <ROLE> user found for this branch' as text with no
  // reassign action behind it.
  //
  // Non-fatal: a failure here must not mask the dispatch retries above, which are
  // the job's primary purpose.
  try {
    report.reresolved = await reresolveUnassignedRequests();
    if (report.reresolved.assigned > 0) {
      console.log(
        `[ProvisioningRetry] Re-resolved ${report.reresolved.assigned} unassigned request(s)`,
      );
    }
  } catch (err) {
    console.error('[ProvisioningRetry] Re-resolution pass failed:', err instanceof Error ? err.message : String(err));
  }

  return report;
}
