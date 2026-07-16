/**
 * Reconciliation Service
 *
 * Queries to detect data anomalies across the candidate-to-employee lifecycle.
 * All queries use verified column names from the live schema (2026-07-16).
 *
 * Covers:
 * - BGV anomalies (auto-approved, missing checks, score without evidence)
 * - Salary anomalies (annual = monthly, missing structure, duplicates)
 * - Lifecycle anomalies (no employee, no bridge, offer approved without employee)
 * - Provisioning anomalies (missing tasks, overdue SLA, sync gaps)
 * - Candidate/employee duplication
 */

import { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

// ── BGV Anomalies ──────────────────────────────────────────────────────────────

export async function getBgvAutoApprovedCandidates() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       r.candidate_id,
       c.candidate_code,
       c.full_name,
       c.mobile,
       r.overall_status,
       r.bgv_score,
       r.is_auto_approved,
       COUNT(ch.id)                                                    AS total_checks,
       SUM(ch.is_auto_approved)                                        AS auto_approved_checks,
       SUM(CASE WHEN ch.status = 'verified' THEN 1 ELSE 0 END)        AS verified_checks,
       SUM(CASE WHEN ch.status = 'pending'  THEN 1 ELSE 0 END)        AS pending_checks,
       ob.employee_id,
       e.employee_code
     FROM candidate_bgv_report r
     JOIN ats_candidate c   ON c.id = r.candidate_id
     LEFT JOIN candidate_bgv_check ch ON ch.candidate_id = r.candidate_id
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = r.candidate_id
     LEFT JOIN employees e  ON e.id = ob.employee_id
     WHERE r.is_auto_approved = 1
     GROUP BY r.candidate_id, c.candidate_code, c.full_name, c.mobile,
              r.overall_status, r.bgv_score, r.is_auto_approved,
              ob.employee_id, e.employee_code
     ORDER BY auto_approved_checks DESC, r.candidate_id`
  );
  return rows;
}

export async function getBgvClearWithoutMandatoryChecks() {
  // Report is clear but not all mandatory checks are verified
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       r.candidate_id,
       c.candidate_code,
       c.full_name,
       r.overall_status,
       r.bgv_score,
       GROUP_CONCAT(
         CASE WHEN ch.status != 'verified' THEN CONCAT(ch.check_type, ':', ch.status) END
         ORDER BY ch.check_type SEPARATOR ', '
       ) AS unverified_checks
     FROM candidate_bgv_report r
     JOIN ats_candidate c ON c.id = r.candidate_id
     LEFT JOIN candidate_bgv_check ch ON ch.candidate_id = r.candidate_id
     WHERE r.overall_status = 'clear'
       AND EXISTS (
         SELECT 1 FROM candidate_bgv_check cx
         WHERE cx.candidate_id = r.candidate_id
           AND cx.check_type IN ('pan', 'aadhaar_offline', 'bank')
           AND cx.status != 'verified'
       )
     GROUP BY r.candidate_id, c.candidate_code, c.full_name,
              r.overall_status, r.bgv_score
     ORDER BY r.candidate_id`
  );
  return rows;
}

export async function getBgvPayrollEligibleWithPendingChecks() {
  // Candidates who cleared Payroll HR validation but BGV not truly verified
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       pv.candidate_id,
       c.candidate_code,
       c.full_name,
       pv.validation_status,
       r.overall_status    AS bgv_overall_status,
       r.is_auto_approved  AS bgv_auto_approved,
       r.bgv_score
     FROM ats_payroll_hr_validation pv
     JOIN ats_candidate c ON c.id = pv.candidate_id
     LEFT JOIN candidate_bgv_report r ON r.candidate_id = pv.candidate_id
     WHERE pv.validation_status = 'validated'
       AND (
         r.id IS NULL
         OR r.is_auto_approved = 1
         OR r.overall_status NOT IN ('clear')
       )
     ORDER BY pv.created_at DESC`
  );
  return rows;
}

// ── Salary Anomalies ───────────────────────────────────────────────────────────

export async function getSalaryAnnualEqualsMonthlyGross() {
  // offered_ctc ≈ gross (monthly) — possible annual stored as monthly
  // Flag when |offered_ctc - gross| < gross * 0.05 (within 5%)
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       o.candidate_id,
       c.candidate_code,
       c.full_name,
       o.offered_ctc         AS annual_ctc_in_offer,
       o.gross               AS monthly_gross_in_offer,
       pv.gross_salary       AS monthly_gross_in_payroll,
       o.date_of_joining,
       o.status              AS offer_status,
       ob.employee_id,
       e.employee_code
     FROM ats_employment_offer o
     JOIN ats_candidate c ON c.id = o.candidate_id
     LEFT JOIN ats_payroll_hr_validation pv ON pv.candidate_id = o.candidate_id
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = o.candidate_id
     LEFT JOIN employees e ON e.id = ob.employee_id
     WHERE o.gross > 0
       AND o.offered_ctc > 0
       AND ABS(o.offered_ctc - o.gross) / o.gross < 0.05
     ORDER BY o.candidate_id`
  );
  return rows;
}

export async function getSalaryJoiningAfterSalaryStart() {
  // Salary effective date before joining date — statutory violation
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       pv.candidate_id,
       c.candidate_code,
       c.full_name,
       pv.joining_date,
       pv.salary_start_date,
       DATEDIFF(pv.joining_date, pv.salary_start_date) AS days_difference,
       ob.employee_id,
       e.employee_code
     FROM ats_payroll_hr_validation pv
     JOIN ats_candidate c ON c.id = pv.candidate_id
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = pv.candidate_id
     LEFT JOIN employees e ON e.id = ob.employee_id
     WHERE pv.salary_start_date IS NOT NULL
       AND pv.joining_date IS NOT NULL
       AND pv.salary_start_date < pv.joining_date
     ORDER BY days_difference DESC`
  );
  return rows;
}

export async function getDuplicateActiveSalaryAssignments() {
  // Multiple active salary_assignment rows for same employee
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       sa.employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       COUNT(sa.id)          AS active_assignments,
       GROUP_CONCAT(sa.id ORDER BY sa.created_at SEPARATOR ', ') AS assignment_ids,
       GROUP_CONCAT(sa.ctc_annual ORDER BY sa.created_at SEPARATOR ', ') AS ctc_values
     FROM employee_salary_assignment sa
     JOIN employees e ON e.id = sa.employee_id
     WHERE sa.active_status = 1
     GROUP BY sa.employee_id, e.employee_code, employee_name
     HAVING active_assignments > 1
     ORDER BY active_assignments DESC`
  );
  return rows;
}

export async function getEmployeesWithoutSalaryAssignment() {
  // Active employees with no salary assignment
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id          AS employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       e.date_of_joining,
       e.employment_status,
       e.active_status
     FROM employees e
     WHERE e.active_status = 1
       AND NOT EXISTS (
         SELECT 1 FROM employee_salary_assignment sa
         WHERE sa.employee_id = e.id AND sa.active_status = 1
       )
     ORDER BY e.date_of_joining DESC
     LIMIT 200`
  );
  return rows;
}

// ── Lifecycle Anomalies ────────────────────────────────────────────────────────

export async function getCandidatesOnboardedWithoutEmployee() {
  // Candidate marked onboarded but no employee_id in bridge
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       c.id          AS candidate_id,
       c.candidate_code,
       c.full_name,
       c.profile_status,
       ob.id         AS bridge_id,
       ob.employee_id,
       ob.status     AS bridge_status,
       ob.created_at AS bridge_created
     FROM ats_candidate c
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
     WHERE c.profile_status = 'onboarded'
       AND (ob.employee_id IS NULL OR ob.id IS NULL)
     ORDER BY c.id`
  );
  return rows;
}

export async function getOfferApprovedWithoutEmployee() {
  // Offer in approved/bh_approved state but no employee in bridge
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       o.id          AS offer_id,
       o.candidate_id,
       c.candidate_code,
       c.full_name,
       o.status      AS offer_status,
       o.date_of_joining,
       o.created_at  AS offer_created,
       ob.employee_id,
       ob.status     AS bridge_status
     FROM ats_employment_offer o
     JOIN ats_candidate c ON c.id = o.candidate_id
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = o.candidate_id
     WHERE o.status IN ('bh_approved', 'approved')
       AND (ob.employee_id IS NULL)
     ORDER BY o.created_at DESC`
  );
  return rows;
}

export async function getEmployeesCreatedBeforeBgvClear() {
  // Employee exists but BGV not clear at time of creation
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id          AS employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       e.date_of_joining,
       ob.candidate_id,
       c.candidate_code,
       r.overall_status   AS bgv_status,
       r.bgv_score,
       r.is_auto_approved AS bgv_auto_approved
     FROM employees e
     JOIN ats_onboarding_bridge ob ON ob.employee_id = e.id
     JOIN ats_candidate c ON c.id = ob.candidate_id
     LEFT JOIN candidate_bgv_report r ON r.candidate_id = ob.candidate_id
     WHERE (
       r.id IS NULL
       OR r.overall_status NOT IN ('clear')
       OR r.is_auto_approved = 1
     )
     AND e.active_status = 1
     ORDER BY e.date_of_joining DESC
     LIMIT 200`
  );
  return rows;
}

export async function getEmployeesActiveBeforeJoiningDate() {
  // active_status=1 but date_of_joining is in the future
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id          AS employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       e.date_of_joining,
       DATEDIFF(e.date_of_joining, CURDATE()) AS days_until_joining,
       e.employment_status,
       e.active_status
     FROM employees e
     WHERE e.active_status = 1
       AND e.date_of_joining > CURDATE()
     ORDER BY e.date_of_joining ASC
     LIMIT 100`
  );
  return rows;
}

export async function getEmployeesCreatedWithoutProvisioning() {
  // Employee created but no provisioning tasks dispatched
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id          AS employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       e.date_of_joining,
       e.employment_status,
       e.created_at,
       COUNT(pr.id)  AS task_count
     FROM employees e
     LEFT JOIN it_provisioning_request pr ON pr.employee_id = e.id AND pr.request_type = 'join'
     WHERE e.created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
     GROUP BY e.id, e.employee_code, employee_name, e.date_of_joining,
              e.employment_status, e.created_at
     HAVING task_count = 0
     ORDER BY e.created_at DESC`
  );
  return rows;
}

// ── Provisioning Anomalies ─────────────────────────────────────────────────────

export async function getProvisioningMissingMandatoryTasks() {
  // Active employees missing one or more mandatory provisioning tasks
  const mandatoryTasks = ['IT_EMAIL_DOMAIN_ASSET', 'ADMIN_BIOMETRIC_ID_CARD', 'WFM_PROCESS_ALIGNMENT', 'APPOINTMENT_LETTER_ESIGN'];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id          AS employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       e.date_of_joining,
       e.active_status,
       e.employment_status,
       GROUP_CONCAT(
         CASE WHEN pr.id IS NULL THEN mt.task_code ELSE NULL END
         ORDER BY mt.task_code SEPARATOR ', '
       ) AS missing_tasks
     FROM employees e
     JOIN (
       SELECT 'IT_EMAIL_DOMAIN_ASSET'    AS task_code UNION ALL
       SELECT 'ADMIN_BIOMETRIC_ID_CARD'  UNION ALL
       SELECT 'WFM_PROCESS_ALIGNMENT'    UNION ALL
       SELECT 'APPOINTMENT_LETTER_ESIGN'
     ) mt ON 1=1
     LEFT JOIN it_provisioning_request pr
       ON pr.employee_id = e.id
      AND pr.task_code = mt.task_code
      AND pr.request_type = 'join'
     WHERE e.created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
     GROUP BY e.id, e.employee_code, employee_name, e.date_of_joining,
              e.active_status, e.employment_status
     HAVING missing_tasks IS NOT NULL
     ORDER BY e.date_of_joining DESC`,
    mandatoryTasks
  );
  return rows;
}

export async function getProvisioningOfficialEmailMismatch() {
  // IT task marked actioned with official_email but employees.official_email differs
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       pr.employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       pr.official_email  AS task_official_email,
       e.official_email   AS employee_official_email,
       pr.status          AS task_status,
       pr.actioned_at
     FROM it_provisioning_request pr
     JOIN employees e ON e.id = pr.employee_id
     WHERE pr.task_code = 'IT_EMAIL_DOMAIN_ASSET'
       AND pr.official_email IS NOT NULL
       AND pr.official_email != ''
       AND (
         e.official_email IS NULL
         OR e.official_email != pr.official_email
       )
     ORDER BY pr.actioned_at DESC`
  );
  return rows;
}

export async function getProvisioningTasksActionedButEmployeeStillInactive() {
  // All mandatory tasks actioned but employee still inactive
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id          AS employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       e.date_of_joining,
       e.active_status,
       e.employment_status,
       COUNT(pr.id)  AS total_tasks,
       SUM(CASE WHEN pr.status IN ('actioned','verified','waived') THEN 1 ELSE 0 END) AS completed_tasks
     FROM employees e
     JOIN it_provisioning_request pr ON pr.employee_id = e.id AND pr.request_type = 'join'
     WHERE e.active_status = 0
       AND e.date_of_joining <= CURDATE()
     GROUP BY e.id, e.employee_code, employee_name, e.date_of_joining,
              e.active_status, e.employment_status
     HAVING total_tasks > 0 AND total_tasks = completed_tasks
     ORDER BY e.date_of_joining ASC`
  );
  return rows;
}

export async function getProvisioningDuplicateTasks() {
  // Same employee has duplicate tasks for same task_code
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       pr.employee_id,
       e.employee_code,
       CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name,
       pr.task_code,
       COUNT(pr.id) AS duplicate_count,
       GROUP_CONCAT(pr.id ORDER BY pr.created_at SEPARATOR ', ') AS task_ids,
       GROUP_CONCAT(pr.status ORDER BY pr.created_at SEPARATOR ', ') AS statuses
     FROM it_provisioning_request pr
     JOIN employees e ON e.id = pr.employee_id
     WHERE pr.request_type = 'join'
     GROUP BY pr.employee_id, e.employee_code, employee_name, pr.task_code
     HAVING duplicate_count > 1
     ORDER BY duplicate_count DESC, pr.task_code`
  );
  return rows;
}

// ── Candidate-Employee Duplication ────────────────────────────────────────────

export async function getMultipleEmployeesForOneCandidate() {
  // One candidate linked to multiple employees via bridge
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       ob.candidate_id,
       c.candidate_code,
       c.full_name,
       COUNT(DISTINCT ob.employee_id) AS employee_count,
       GROUP_CONCAT(DISTINCT e.employee_code ORDER BY e.created_at SEPARATOR ', ') AS employee_codes
     FROM ats_onboarding_bridge ob
     JOIN ats_candidate c ON c.id = ob.candidate_id
     JOIN employees e ON e.id = ob.employee_id
     WHERE ob.employee_id IS NOT NULL
     GROUP BY ob.candidate_id, c.candidate_code, c.full_name
     HAVING employee_count > 1`
  );
  return rows;
}

export async function getEmployeeCodeMismatchBetweenBridgeAndEmployee() {
  // ats_candidate.employee_code differs from employees.employee_code
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       c.id          AS candidate_id,
       c.candidate_code,
       c.full_name,
       c.employee_code AS candidate_employee_code,
       e.employee_code AS actual_employee_code,
       e.id          AS employee_id
     FROM ats_candidate c
     JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
     JOIN employees e ON e.id = ob.employee_id
     WHERE c.employee_code IS NOT NULL
       AND c.employee_code != e.employee_code
     ORDER BY c.id`
  );
  return rows;
}

// ── Summary Report ─────────────────────────────────────────────────────────────

export async function getReconciliationSummary() {
  const [result] = await db.execute<RowDataPacket[]>(
    `SELECT
       -- BGV
       (SELECT COUNT(DISTINCT r.candidate_id) FROM candidate_bgv_report r WHERE r.is_auto_approved = 1)
         AS bgv_auto_approved_count,
       (SELECT COUNT(DISTINCT pv.candidate_id) FROM ats_payroll_hr_validation pv
         LEFT JOIN candidate_bgv_report r ON r.candidate_id = pv.candidate_id
         WHERE pv.validation_status = 'validated' AND (r.id IS NULL OR r.is_auto_approved = 1))
         AS bgv_payroll_eligible_without_real_bgv,

       -- Salary
       (SELECT COUNT(*) FROM ats_employment_offer o
         WHERE o.gross > 0 AND o.offered_ctc > 0 AND ABS(o.offered_ctc - o.gross) / o.gross < 0.05)
         AS salary_annual_equals_monthly_count,
       (SELECT COUNT(*) FROM employee_salary_assignment sa
         WHERE sa.active_status = 1
         GROUP BY sa.employee_id HAVING COUNT(*) > 1)
         AS employees_with_duplicate_salary,

       -- Lifecycle
       (SELECT COUNT(*) FROM ats_candidate c
         LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
         WHERE c.profile_status = 'onboarded' AND (ob.employee_id IS NULL OR ob.id IS NULL))
         AS onboarded_without_employee,
       (SELECT COUNT(*) FROM ats_employment_offer o
         LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = o.candidate_id
         WHERE o.status IN ('bh_approved', 'approved') AND ob.employee_id IS NULL)
         AS offer_approved_no_employee,
       (SELECT COUNT(*) FROM employees e
         WHERE e.active_status = 1 AND e.date_of_joining > CURDATE())
         AS active_employees_before_joining,

       -- Provisioning
       (SELECT COUNT(DISTINCT pr.employee_id) FROM it_provisioning_request pr
         WHERE pr.sla_due_at IS NOT NULL AND pr.sla_due_at < NOW()
           AND pr.status NOT IN ('actioned','verified','waived','cancelled'))
         AS sla_overdue_employees,
       (SELECT COUNT(DISTINCT pr.employee_id) FROM it_provisioning_request pr
         WHERE pr.assignment_exception = 1 AND pr.status = 'pending_unassigned')
         AS employees_with_unassigned_tasks,

       -- Official email sync gap
       (SELECT COUNT(*) FROM it_provisioning_request pr
         JOIN employees e ON e.id = pr.employee_id
         WHERE pr.task_code = 'IT_EMAIL_DOMAIN_ASSET'
           AND pr.official_email IS NOT NULL AND pr.official_email != ''
           AND (e.official_email IS NULL OR e.official_email != pr.official_email))
         AS it_email_sync_gap
     `
  );
  return result[0];
}
