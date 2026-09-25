/**
 * Salary start date - the single place that changes it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Payroll reads employees.salary_start_date to decide whether an employee is paid in a month at
 * all and how many days are paid in the first month (payrollCalculate.service.ts: the
 * `salary_start_date gate` and the active-calendar-days cap). It picks the salary assignment from
 * employee_salary_assignment.effective_from. Payroll Head assigns the date; before this module
 * six different code paths each changed some subset of the five stored copies and none changed
 * all of them. Live audit 2026-09-25, 213 HRMS-onboarded employees: 73 disagreed between
 * employees.salary_start_date and the assignment payroll was paid on (395 backdated days lost),
 * 70 disagreed between employees and the validation row, 15 between assignment and package date,
 * 11 had two active assignments.
 *
 * THE RULE
 * --------
 * Payroll Head's assigned date is the one authoritative salary start date. Every change goes
 * through applySalaryStartDate(), which in ONE transaction:
 *   1. validates the date is a real YYYY-MM-DD calendar date;
 *   2. applies the date locks - a date before joining or before today is refused, except for
 *      payroll_head and super_admin (canBackdateDates), who may do either with a mandatory
 *      reason (owner decisions 2026-09-25). Once Payroll Head has approved a salary the date can
 *      only be changed by the reviewer tier (payroll_head, admin, super_admin);
 *   3. refuses a change that would touch a closed (finalized/locked/disbursed) payroll month;
 *   4. writes every copy - employees, the ATS validation row, the review package date, the active
 *      salary assignment and component assignment - and FAILS LOUDLY if any write does not take.
 *      The old helper swallowed errors, which is exactly how employees.salary_start_date stayed
 *      on the joining date while Payroll Head's backdated date sat on the other copies;
 *   5. reads every copy back and rolls the whole change back if they still disagree;
 *   6. writes an audit row (employee_salary_start_date_audit).
 *
 * The payroll arithmetic itself is not touched: payroll keeps reading the same columns. This
 * module only guarantees those columns are right.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { canBackdateDates, getIstDateString } from "../../utils/dateUtils.js";
import { isRunClosed } from "./run-status.js";

import {
  affectedPayrollMonths,
  assessSalaryStartDate,
  dayOf,
  normaliseSalaryDate,
  type SalaryDateAssessment,
  type SalaryDateAuthority,
  type SalaryDateSource,
} from "./salary-start-date.rules.js";

export * from "./salary-start-date.rules.js";
export * from "./salary-start-date.reconciliation.js";

function httpError(message: string, statusCode: number, code: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

export type SqlExecutor = { execute: (typeof db)["execute"] };

export interface PayrollRunRef {
  runId: string;
  runMonth: string;
  status: string;
}

/**
 * Payroll runs that cover this employee in the given months. Covered means the run is unscoped or
 * scoped to the employee's own branch/process, or the employee already has a line in it.
 */
async function runsCoveringEmployee(
  exec: SqlExecutor,
  employeeId: string,
  branchId: string | null,
  processId: string | null,
  months: string[],
): Promise<PayrollRunRef[]> {
  if (!months.length) return [];
  const first = months[0];
  const last = months[months.length - 1];
  const [rows] = await exec.execute<RowDataPacket[]>(
    `SELECT r.id, r.run_month, r.status
       FROM salary_prep_run r
      WHERE r.run_month BETWEEN ? AND ?
        AND ( ((r.branch_id IS NULL OR r.branch_id = ?) AND (r.process_id IS NULL OR r.process_id = ?))
              OR EXISTS (SELECT 1 FROM salary_prep_line l WHERE l.run_id = r.id AND l.employee_id = ?) )`,
    [first, last, branchId, processId, employeeId],
  );
  return rows.map((r) => ({
    runId: String(r.id),
    runMonth: String(r.run_month),
    status: String(r.status),
  }));
}

/**
 * A closed payroll month is settled money. A salary start date change that reaches back into one -
 * or forward out of one - would leave a paid month disagreeing with the employee's own record.
 * Refused outright; correcting a closed month is a separate, deliberate payroll action.
 */
export async function assertPayrollMonthsOpen(
  exec: SqlExecutor,
  employee: { id: string; branchId: string | null; processId: string | null },
  months: string[],
): Promise<PayrollRunRef[]> {
  const runs = await runsCoveringEmployee(
    exec,
    employee.id,
    employee.branchId,
    employee.processId,
    months,
  );
  const closed = runs.filter((r) => isRunClosed(r.status));
  if (closed.length) {
    throw httpError(
      `Salary start date cannot be changed: payroll for ${[...new Set(closed.map((r) => r.runMonth))].join(", ")} ` +
        `is already ${[...new Set(closed.map((r) => r.status.toLowerCase()))].join("/")}. ` +
        `Correct a closed month through a payroll adjustment, not by moving the start date.`,
      409,
      "PAYROLL_MONTH_CLOSED",
    );
  }
  // Open but already calculated runs are returned so the caller can tell the user to recalculate.
  return runs;
}

export interface ApplySalaryStartDateArgs {
  employeeId: string;
  newDate: string;
  actorUserId: string | null;
  source: SalaryDateSource;
  authority: SalaryDateAuthority;
  /** May go before joining / before today (see actorAuthority). Defaults to false. */
  allowBackdate?: boolean;
  /** Mandatory (>= 5 chars) when a backdating actor goes before joining or before today. */
  reason?: string | null;
  /**
   * The caller has already written employee_salary_assignment.effective_from itself (the Payroll
   * Head paths do). The service then only verifies it instead of writing it.
   */
  assignmentAlreadyWritten?: boolean;
  /** Override "now" in tests. */
  today?: string;
}

export interface ApplySalaryStartDateResult {
  employeeId: string;
  oldDate: string | null;
  newDate: string;
  changed: boolean;
  preJoining: boolean;
  beforeToday: boolean;
  copiesWritten: string[];
  /** Open payroll runs already calculated for the affected months - they need recalculating. */
  openRunsToRecalculate: PayrollRunRef[];
}

interface EmployeeRow {
  id: string;
  employeeCode: string | null;
  dateOfJoining: string | null;
  salaryStartDate: string | null;
  candidateId: string | null;
  branchId: string | null;
  processId: string | null;
}

async function loadEmployeeForUpdate(
  exec: SqlExecutor,
  employeeId: string,
  lock = true,
): Promise<EmployeeRow> {
  const [rows] = await exec.execute<RowDataPacket[]>(
    `SELECT id, employee_code, date_of_joining, salary_start_date, candidate_id, branch_id, process_id
       FROM employees WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [employeeId],
  );
  const r = rows[0];
  if (!r) throw httpError("Employee not found.", 404, "EMPLOYEE_NOT_FOUND");
  return {
    id: String(r.id),
    employeeCode: r.employee_code ? String(r.employee_code) : null,
    dateOfJoining: dayOf(r.date_of_joining) || null,
    salaryStartDate: dayOf(r.salary_start_date) || null,
    candidateId: r.candidate_id ? String(r.candidate_id) : null,
    branchId: r.branch_id ? String(r.branch_id) : null,
    processId: r.process_id ? String(r.process_id) : null,
  };
}

interface CopyState {
  validationId: string | null;
  validationDate: string | null;
  reviewId: string | null;
  reviewStatus: string | null;
  packageDate: string | null;
  assignmentRows: Array<{ id: string; effectiveFrom: string; active: boolean }>;
  activeComponentId: string | null;
  activeComponentDate: string | null;
  /** A salary increment / Salary Change Center change is on record for this employee. */
  hasSalaryChange: boolean;
}

async function loadCopyState(
  exec: SqlExecutor,
  emp: EmployeeRow,
): Promise<CopyState> {
  let candidateId = emp.candidateId;
  const [reviewRows] = await exec.execute<RowDataPacket[]>(
    `SELECT id, status, candidate_id, package_effective_from
       FROM employee_payroll_head_review WHERE employee_id = ? LIMIT 1`,
    [emp.id],
  );
  const review = reviewRows[0];
  // employees.candidate_id is NULL for 107 of 209 reviewed employees; the review row always has it.
  if (!candidateId && review?.candidate_id)
    candidateId = String(review.candidate_id);

  let validationId: string | null = null;
  let validationDate: string | null = null;
  if (candidateId) {
    const [vRows] = await exec.execute<RowDataPacket[]>(
      `SELECT id, salary_start_date FROM ats_payroll_hr_validation
        WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
      [candidateId],
    );
    if (vRows[0]) {
      validationId = String(vRows[0].id);
      validationDate = dayOf(vRows[0].salary_start_date) || null;
    }
  }

  const [aRows] = await exec.execute<RowDataPacket[]>(
    `SELECT id, effective_from, active_status FROM employee_salary_assignment
      WHERE employee_id = ? ORDER BY effective_from DESC, created_at DESC`,
    [emp.id],
  );
  const [cRows] = await exec.execute<RowDataPacket[]>(
    `SELECT id, effective_date FROM salary_component_assignments
      WHERE employee_id = ? AND status = 'active' ORDER BY effective_date DESC LIMIT 1`,
    [emp.id],
  );
  // A later date on the assignment is an increment, not a stale start date, when the employee has a
  // salary change on record. Both tables exist in production; a missing one (a fresh environment)
  // means "no changes", any other error propagates.
  let hasSalaryChange = false;
  try {
    const [chg] = await exec.execute<RowDataPacket[]>(
      `SELECT (EXISTS (SELECT 1 FROM employee_salary_change_log WHERE employee_id = ?)
            OR EXISTS (SELECT 1 FROM salary_increment_request WHERE employee_id = ? AND status = 'implemented')) AS n`,
      [emp.id, emp.id],
    );
    hasSalaryChange = Number(chg[0]?.n ?? 0) === 1;
  } catch (e) {
    if ((e as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw e;
  }
  return {
    validationId,
    validationDate,
    hasSalaryChange,
    reviewId: review ? String(review.id) : null,
    reviewStatus: review ? String(review.status) : null,
    packageDate: review ? dayOf(review.package_effective_from) || null : null,
    assignmentRows: aRows.map((a) => ({
      id: String(a.id),
      effectiveFrom: dayOf(a.effective_from),
      active: Number(a.active_status) === 1,
    })),
    activeComponentId: cRows[0] ? String(cRows[0].id) : null,
    activeComponentDate: cRows[0]
      ? dayOf(cRows[0].effective_date) || null
      : null,
  };
}

/**
 * True when the assignment payroll picks first carries the salary start date, as opposed to a later
 * salary change. It carries it when its date is one Payroll Head's records agree on (the employee
 * record, the HR validation row, the package date) - or when its date is unexplained and the
 * employee has no salary change on record, i.e. it is a stale start-date row that re-saving must
 * repair. An unexplained date on an employee who HAS had a salary change is an increment and is
 * left alone: overwriting it would pay the old salary from the increment date.
 */
function assignmentCarriesStartDate(
  state: CopyState,
  oldDate: string | null,
): boolean {
  const first = state.assignmentRows.find((a) => a.active);
  if (!first) return false;
  const known = new Set(
    [oldDate, state.validationDate, state.packageDate].filter(Boolean),
  );
  if (known.has(first.effectiveFrom)) return true;
  return !state.hasSalaryChange;
}

/** Result of the validation half: everything decided, nothing written. */
export interface PreparedSalaryStartDate {
  args: ApplySalaryStartDateArgs;
  newDate: string;
  emp: EmployeeRow;
  state: CopyState;
  oldDate: string | null;
  assessment: SalaryDateAssessment;
  openRunsToRecalculate: PayrollRunRef[];
}

/**
 * Validation half of a salary start date change: locks the employee row, applies the authority,
 * date-lock and closed-month rules, and writes NOTHING. Callers that must write their own rows
 * first (the Payroll Head package paths) call this BEFORE those writes - otherwise the locks would
 * see their own freshly written date as "already carried" and never fire - then call
 * commitSalaryStartDate() afterwards. MUST run inside the caller's transaction.
 */
export async function prepareSalaryStartDate(
  exec: SqlExecutor,
  args: ApplySalaryStartDateArgs,
): Promise<PreparedSalaryStartDate> {
  const newDate = normaliseSalaryDate(args.newDate);
  const emp = await loadEmployeeForUpdate(exec, args.employeeId);
  const state = await loadCopyState(exec, emp);
  const oldDate = emp.salaryStartDate;

  // After Payroll Head approves a salary review the date belongs to Payroll Head. Payroll HR, HR
  // and Joining Control Room may not move it; they raise a revision request instead.
  if (
    args.authority !== "payroll_head" &&
    state.reviewStatus === "approved" &&
    newDate !== oldDate
  ) {
    throw httpError(
      "This employee's salary was approved by Payroll Head, so the salary start date can only be " +
        "changed by Payroll Head. Raise a salary date revision request instead.",
      403,
      "SALARY_DATE_OWNED_BY_PAYROLL_HEAD",
    );
  }

  const today = args.today ?? getIstDateString();
  const firstActiveDate =
    state.assignmentRows.find((a) => a.active)?.effectiveFrom ?? null;
  const assessment = assessSalaryStartDate({
    newDate,
    dateOfJoining: emp.dateOfJoining,
    today,
    unchangedFrom: [oldDate, state.validationDate, firstActiveDate],
    allowBackdate: args.allowBackdate === true,
    reason: args.reason,
  });

  const months = affectedPayrollMonths(
    [oldDate, state.validationDate, state.packageDate, firstActiveDate],
    newDate,
  );
  const runs = await assertPayrollMonthsOpen(
    exec,
    { id: emp.id, branchId: emp.branchId, processId: emp.processId },
    months,
  );
  return {
    args,
    newDate,
    emp,
    state,
    oldDate,
    assessment,
    openRunsToRecalculate: runs.filter((r) => !isRunClosed(r.status)),
  };
}

/** Applies a salary start date to every stored copy (prepare + commit in one call). */
export async function applySalaryStartDate(
  exec: SqlExecutor,
  args: ApplySalaryStartDateArgs,
): Promise<ApplySalaryStartDateResult> {
  return commitSalaryStartDate(exec, await prepareSalaryStartDate(exec, args));
}

/** Write half: updates every copy, verifies them, audits. Follows prepareSalaryStartDate(). */
export async function commitSalaryStartDate(
  exec: SqlExecutor,
  prepared: PreparedSalaryStartDate,
): Promise<ApplySalaryStartDateResult> {
  const {
    args,
    newDate,
    emp,
    state,
    oldDate,
    assessment,
    openRunsToRecalculate,
  } = prepared;

  const copiesWritten: string[] = [];
  const flag =
    args.allowBackdate === true &&
    emp.dateOfJoining &&
    newDate < emp.dateOfJoining
      ? 1
      : 0;

  // 1. employees - the column payroll reads. The check constraint (1884) refuses a date before
  //    joining unless the approved flag is set in the same statement.
  await exec.execute(
    `UPDATE employees SET salary_start_date = ?, salary_start_pre_joining_approved = ? WHERE id = ?`,
    [newDate, flag, emp.id],
  );
  copiesWritten.push("employees.salary_start_date");

  // 2. ATS validation row (what the review screen shows).
  if (state.validationId) {
    await exec.execute(
      `UPDATE ats_payroll_hr_validation SET salary_start_date = ? WHERE id = ?`,
      [newDate, state.validationId],
    );
    copiesWritten.push("ats_payroll_hr_validation.salary_start_date");
  }

  // 3. Payroll Head's package date, only where a package has been assigned.
  if (state.reviewId && state.packageDate) {
    await exec.execute(
      `UPDATE employee_payroll_head_review SET package_effective_from = ? WHERE id = ?`,
      [newDate, state.reviewId],
    );
    copiesWritten.push("employee_payroll_head_review.package_effective_from");
  }

  // 4. The salary assignment payroll selects by effective_from. Written only when it carries the
  //    start date (a later increment row must keep its own date). If two rows are active, the one
  //    payroll picks first (latest effective_from) is updated; the extra active row is left for
  //    the reconciliation check to report - closing it here could silently drop an increment that
  //    legitimately starts later.
  if (
    !args.assignmentAlreadyWritten &&
    assignmentCarriesStartDate(state, oldDate)
  ) {
    const first = state.assignmentRows.find((a) => a.active);
    if (first) {
      await exec.execute(
        `UPDATE employee_salary_assignment SET effective_from = ?, updated_at = NOW() WHERE id = ?`,
        [newDate, first.id],
      );
      copiesWritten.push("employee_salary_assignment.effective_from");
    }
  }

  // 5. Component assignment date (display/history: payroll reads amounts by status). Loaded now,
  //    not taken from prepare: the Payroll Head package paths supersede the old row and insert a
  //    new one between prepare and commit, and the superseded row's history date must not change.
  const [compRows] = await exec.execute<RowDataPacket[]>(
    `SELECT id, effective_date FROM salary_component_assignments
      WHERE employee_id = ? AND status = 'active' ORDER BY effective_date DESC LIMIT 1`,
    [emp.id],
  );
  const comp = compRows[0];
  if (
    comp &&
    dayOf(comp.effective_date) !== newDate &&
    (!oldDate || dayOf(comp.effective_date) === oldDate)
  ) {
    await exec.execute(
      `UPDATE salary_component_assignments SET effective_date = ? WHERE id = ?`,
      [newDate, String(comp.id)],
    );
    copiesWritten.push("salary_component_assignments.effective_date");
  }

  await verifyCopies(
    exec,
    emp.id,
    newDate,
    flag,
    args.assignmentAlreadyWritten === true ||
      assignmentCarriesStartDate(state, oldDate),
  );

  await exec.execute(
    `INSERT INTO employee_salary_start_date_audit
       (id, employee_id, old_date, new_date, source, authority, pre_joining, before_today, reason, actor_user_id, copies_written)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      emp.id,
      oldDate,
      newDate,
      args.source,
      args.authority,
      assessment.preJoining ? 1 : 0,
      assessment.beforeToday ? 1 : 0,
      args.reason ? args.reason.trim().slice(0, 500) : null,
      args.actorUserId,
      copiesWritten.join(",").slice(0, 255),
    ],
  );

  return {
    employeeId: emp.id,
    oldDate,
    newDate,
    changed: oldDate !== newDate,
    preJoining: assessment.preJoining,
    beforeToday: assessment.beforeToday,
    copiesWritten,
    openRunsToRecalculate,
  };
}

/** Reads the copies back inside the transaction; any disagreement throws so the caller rolls back. */
async function verifyCopies(
  exec: SqlExecutor,
  employeeId: string,
  expected: string,
  expectedFlag: number,
  expectAssignment: boolean,
): Promise<void> {
  const emp = await loadEmployeeForUpdate(exec, employeeId);
  const state = await loadCopyState(exec, emp);
  const [flagRows] = await exec.execute<RowDataPacket[]>(
    `SELECT salary_start_pre_joining_approved AS f FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const problems: string[] = [];
  if (emp.salaryStartDate !== expected)
    problems.push(`employees=${emp.salaryStartDate}`);
  if (Number(flagRows[0]?.f ?? 0) !== expectedFlag)
    problems.push("pre_joining_flag");
  if (state.validationId && state.validationDate !== expected)
    problems.push(`validation=${state.validationDate}`);
  if (state.reviewId && state.packageDate && state.packageDate !== expected)
    problems.push(`package=${state.packageDate}`);
  if (expectAssignment) {
    const first = state.assignmentRows.find((a) => a.active);
    if (first && first.effectiveFrom !== expected)
      problems.push(`assignment=${first.effectiveFrom}`);
  }
  if (problems.length) {
    throw httpError(
      `Salary start date could not be applied consistently (${problems.join(", ")}); nothing was changed.`,
      500,
      "SALARY_START_DATE_SYNC_FAILED",
    );
  }
}

export interface SalaryStartDateConsistency {
  consistent: boolean;
  /** The date payroll reads (employees.salary_start_date). */
  expected: string | null;
  problems: string[];
}

/**
 * Read-only: do the stored copies of an employee's salary start date agree?
 * employees.salary_start_date is what payroll reads, so it is the reference; the HR validation
 * row, the package date and the assignment payroll picks first must all equal it.
 */
export async function getSalaryStartDateConsistency(
  exec: SqlExecutor,
  employeeId: string,
): Promise<SalaryStartDateConsistency> {
  const emp = await loadEmployeeForUpdate(exec, employeeId, false);
  const state = await loadCopyState(exec, emp);
  const expected = emp.salaryStartDate;
  const problems: string[] = [];
  if (!expected) problems.push("employee record has no salary start date");
  if (expected && state.validationId && state.validationDate !== expected) {
    problems.push(
      `HR validation date ${state.validationDate ?? "empty"} differs from employee date ${expected}`,
    );
  }
  if (
    expected &&
    state.reviewId &&
    state.packageDate &&
    state.packageDate !== expected
  ) {
    problems.push(
      `package date ${state.packageDate} differs from employee date ${expected}`,
    );
  }
  const first = state.assignmentRows.find((a) => a.active);
  if (expected && first && !state.hasSalaryChange && first.effectiveFrom !== expected) {
    problems.push(
      `salary assignment date ${first.effectiveFrom} differs from employee date ${expected}`,
    );
  }
  return { consistent: problems.length === 0, expected, problems };
}

/** Runs applySalaryStartDate in its own transaction. Use when the caller has no transaction of its own. */
export async function setSalaryStartDate(
  args: ApplySalaryStartDateArgs,
): Promise<ApplySalaryStartDateResult> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await applySalaryStartDate(connection, args);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ── Candidate-side helpers (Joining Control Room, Payroll HR validation) ───────

/**
 * After Payroll Head approves a salary the start date belongs to Payroll Head. Payroll HR's
 * validation form and the Joining Control Room write the ATS validation row directly, so they must
 * be stopped BEFORE they write - a later check would leave the validation row already changed.
 * Re-saving the date the employee already carries is allowed.
 */
export async function assertSalaryDateNotOwnedByPayrollHead(
  exec: SqlExecutor,
  candidateId: string,
  newDate: string | null | undefined,
): Promise<void> {
  const date = dayOf(newDate);
  if (!date) return;
  const [rows] = await exec.execute<RowDataPacket[]>(
    `SELECT e.salary_start_date
       FROM employee_payroll_head_review r
       JOIN employees e ON e.id = r.employee_id
      WHERE r.candidate_id = ? AND r.status = 'approved' LIMIT 1`,
    [candidateId],
  );
  if (rows[0] && dayOf(rows[0].salary_start_date) !== date) {
    throw httpError(
      "This employee's salary was approved by Payroll Head, so the salary start date can only be " +
        "changed by Payroll Head. Raise a salary date revision request instead.",
      403,
      "SALARY_DATE_OWNED_BY_PAYROLL_HEAD",
    );
  }
}

async function findEmployeeIdForCandidate(candidateId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM employee_payroll_head_review WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  if (rows[0]) return String(rows[0].employee_id);
  const [emp] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  return emp[0] ? String(emp[0].id) : null;
}

/**
 * Validation only: runs every rule prepareSalaryStartDate applies (ownership, date locks, reason,
 * closed payroll months) inside a transaction that is always rolled back, and writes nothing.
 * Callers that must write other rows BEFORE the date (Payroll Head's create-and-assign creates a
 * catalog package first; the Joining Control Room writes the HR validation row; the employee edit
 * writes the profile) call this first, so a refusal cannot leave those writes half-done.
 */
export async function checkSalaryStartDate(args: ApplySalaryStartDateArgs): Promise<void> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await prepareSalaryStartDate(connection, args);
  } finally {
    await connection.rollback().catch(() => undefined);
    connection.release();
  }
}

/** checkSalaryStartDate for a candidate; does nothing before the employee record exists. */
export async function checkSalaryStartDateForCandidate(args: {
  candidateId: string;
  newDate: string;
  actorUserId: string | null;
  source: SalaryDateSource;
}): Promise<void> {
  const employeeId = await findEmployeeIdForCandidate(args.candidateId);
  if (!employeeId) return;
  await checkSalaryStartDate({
    employeeId,
    newDate: args.newDate,
    actorUserId: args.actorUserId,
    source: args.source,
    authority: "standard",
  });
}

/**
 * When Payroll HR / Joining Control Room change the date for a candidate whose employee record
 * already exists (salary review still pending), carry it to every other copy. Returns null when no
 * employee exists yet - the normal case, since validation happens before employee creation.
 */
export async function syncSalaryStartDateForCandidate(args: {
  candidateId: string;
  newDate: string;
  actorUserId: string | null;
  source: SalaryDateSource;
}): Promise<ApplySalaryStartDateResult | null> {
  const employeeId = await findEmployeeIdForCandidate(args.candidateId);
  if (!employeeId) return null;
  return setSalaryStartDate({
    employeeId,
    newDate: args.newDate,
    actorUserId: args.actorUserId,
    source: args.source,
    authority: "standard",
  });
}

