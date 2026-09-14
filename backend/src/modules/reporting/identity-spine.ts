/**
 * The identity spine — the leading columns every employee-grain report must carry.
 *
 * Business rule (2026-08-07): employee code, cost centre and process name are mandatory
 * on every report that has one row per employee. Measured against the catalog that day,
 * 84 of 115 reports carried employee code, 55 carried process, and only **8 carried cost
 * centre** — 2 carried all three. A report you cannot tie back to a cost centre cannot be
 * reconciled against finance, and one without a process cannot be given to an ops manager.
 *
 * Two traps this exists to prevent, both verified against live mas_hrms:
 *
 *   1. Cost centre is `employees.cost_centre_id -> cost_centre_master`. It is NOT
 *      `call_centre_code`, which is the dialer/biometric integration key and is NULL on
 *      all 58,627 employee rows. Never alias a cost centre as `cc_code`: reporting.service
 *      once emitted the dialer key under that name in the same result set where `cc`
 *      aliased cost_centre_master.
 *
 *   2. Do not COALESCE cost centre down to the legacy free-text `employees.cost_center_code`.
 *      Of 1,125 active employees, 1,061 resolve through the FK and 64 have neither — the
 *      text fallback rescues exactly 0 rows while adding a second spelling of the truth.
 *      Those 64 render as UNASSIGNED and are listed by the `org-mapping-gaps` report.
 *
 * Coverage on 2026-08-07, active employees: cost centre 1,061/1,125 (64 unassigned),
 * process 982/1,125 (143 unassigned), designation 1,006, reporting manager 963.
 * All five org joins resolve with zero orphan FKs.
 */

/** Rendered when an org attribute is unmapped. Rows are never dropped for being unmapped. */
export const UNASSIGNED = "UNASSIGNED";

/**
 * SELECT fragment for the spine. `alias` is the employees alias in the caller's query.
 *
 * Emits, in order: employee_code, employee_name, cost_centre_code, cost_centre_name,
 * process_name, branch_name, department_name, designation_name, date_of_joining,
 * employment_status, employee_state, reporting_manager_code, reporting_manager_name.
 */
export function identitySpineSelect(alias = "e"): string {
  return `${alias}.employee_code,
           COALESCE(NULLIF(${alias}.full_name,''), CONCAT(${alias}.first_name,' ',COALESCE(${alias}.last_name,''))) AS employee_name,
           COALESCE(spine_cc.cost_centre_code, '${UNASSIGNED}') AS cost_centre_code,
           COALESCE(spine_cc.cost_centre_name, '${UNASSIGNED}') AS cost_centre_name,
           COALESCE(spine_p.process_name, '${UNASSIGNED}') AS process_name,
           spine_b.branch_name,
           spine_d.dept_name AS department_name,
           spine_des.designation_name,
           ${alias}.date_of_joining,
           -- Case-normalised. The raw column holds both 'active' (1,037) and 'Active' (86)
           -- among active employees on 2026-08-07; MySQL's case-insensitive collation hides
           -- the split in SQL, but it reaches exports and any JS-side comparison verbatim,
           -- where 'Active' === 'active' is false. This is also why active_status, not this
           -- column, is the definition of an active employee.
           LOWER(${alias}.employment_status) AS employment_status,
           CASE WHEN ${alias}.active_status = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END AS employee_state,
           spine_mgr.employee_code AS reporting_manager_code,
           COALESCE(NULLIF(spine_mgr.full_name,''), CONCAT(spine_mgr.first_name,' ',COALESCE(spine_mgr.last_name,''))) AS reporting_manager_name`;
}

/**
 * The joins `identitySpineSelect` depends on. Aliases are `spine_`-prefixed so they cannot
 * collide with a caller's own joins to the same masters — several executors already join
 * branch_master as `b`, and adding a second join under the same alias is a SQL error.
 *
 * Every join is LEFT: an employee with no cost centre or no process must still appear.
 * Reporting manager follows COALESCE(reporting_manager_id, manager_id) because the two
 * columns disagree on real rows and `manager-mapping` exists to report that.
 */
export function identitySpineJoins(alias = "e"): string {
  return `LEFT JOIN branch_master      spine_b   ON spine_b.id   = ${alias}.branch_id
      LEFT JOIN department_master  spine_d   ON spine_d.id   = ${alias}.department_id
      LEFT JOIN designation_master spine_des ON spine_des.id = ${alias}.designation_id
      LEFT JOIN process_master     spine_p   ON spine_p.id   = ${alias}.process_id
      LEFT JOIN cost_centre_master spine_cc  ON spine_cc.id  = ${alias}.cost_centre_id
      LEFT JOIN employees          spine_mgr ON spine_mgr.id = COALESCE(${alias}.reporting_manager_id, ${alias}.manager_id)`;
}

/** Column keys the spine emits, in order — the contract test asserts against this. */
export const IDENTITY_SPINE_COLUMNS = [
  "employee_code",
  "employee_name",
  "cost_centre_code",
  "cost_centre_name",
  "process_name",
  "branch_name",
  "department_name",
  "designation_name",
  "date_of_joining",
  "employment_status",
  "employee_state",
  "reporting_manager_code",
  "reporting_manager_name",
] as const;

/**
 * The three the business declared mandatory. Enforced on every employee-grain report;
 * aggregate reports (one row per branch, per cost centre, per month) are exempt because
 * they have no single employee to name.
 */
export const MANDATORY_IDENTITY_COLUMNS = [
  "employee_code",
  "cost_centre_code",
  "cost_centre_name",
  "process_name",
] as const;
