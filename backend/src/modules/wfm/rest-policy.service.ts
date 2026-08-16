/**
 * Area 2 of the roster enterprise-controls program: configurable minimum
 * rest-between-shifts policy. See sql/1210_minimum_rest_policy.sql.
 *
 * Deliberately has NO hard-coded fallback minimum. If nothing has ever been
 * configured for an employee/process/branch/organization, resolveRestPolicy()
 * returns null, and every caller in this file treats null as
 * REST_POLICY_MISSING — a distinct, blocking, fail-closed state — never as
 * "0 minutes required" (which would silently let every shift pairing pass).
 *
 * Every function accepts an optional trailing `executor` (default: the pool
 * `db`) so a caller already inside a transaction (the bulk-upload services,
 * which hold a dedicated `conn` for the whole batch) can validate through
 * that same connection — same rationale as rosterAssignmentColumns() in
 * shift-scheduling.util.ts, including making those services' existing tests
 * (which mock only `conn.execute`) work unchanged.
 */

import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { hasTable } from "./schema-probe.util.js";

type Executor = { execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]> };

/**
 * Closes a real concurrency hole: rest validation is a read (resolve policy +
 * find adjacent shifts) followed by a write (insert/update the assignment).
 * Two near-simultaneous requests for the SAME employee (e.g. a manual
 * assignment and a manager realignment landing at once) can each read the
 * same "no conflict" state and both commit — producing an impossible pair
 * neither request individually violated. The bulk-upload services' own
 * per-batch transaction does not close this: it only serializes rows WITHIN
 * one batch, not against a different concurrent request using a different
 * connection.
 *
 * Fixed with a MySQL named advisory lock (GET_LOCK/RELEASE_LOCK) scoped to
 * the employee, held on one dedicated connection for the whole validate+write
 * critical section — the exact pattern already established for the same
 * class of problem in leave.service.ts's submitLeaveRequest() (2026-08-13
 * audit). `fn` receives that connection so validation and the write both run
 * through it, keeping the whole critical section on one session the way
 * leave.service.ts's lockConn does.
 *
 * 10-second wait: GET_LOCK blocks until acquired or timeout, so a second
 * caller queues rather than instantly failing under ordinary contention —
 * it only throws if a THIRD request piles up behind an already-waiting one,
 * or a caller genuinely holds the lock unusually long.
 */
export async function withEmployeeRosterLock<T>(
  employeeId: string,
  fn: (conn: Executor) => Promise<T>
): Promise<T> {
  const lockName = `roster_assign_${employeeId}`;
  const lockConn = await db.getConnection();
  try {
    // .query(), not .execute(), for the lock statements specifically —
    // matching leave.service.ts's lockConn exactly (2026-08-13). The
    // parameterized reads/writes fn() performs still go through .execute()
    // as normal; only GET_LOCK/RELEASE_LOCK use the text protocol.
    const [lockRows] = await lockConn.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
    if (Number((lockRows as RowDataPacket[])?.[0]?.acquired) !== 1) {
      throw Object.assign(
        new Error("Another roster change for this employee is already in progress. Please try again."),
        { statusCode: 409, code: "ROSTER_LOCK_TIMEOUT" }
      );
    }
    try {
      return await fn(lockConn);
    } finally {
      await lockConn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
    }
  } finally {
    lockConn.release();
  }
}

/**
 * Distinguishes "the feature hasn't been turned on yet" (migration
 * 1210_minimum_rest_policy.sql not applied — wfm_rest_policy doesn't exist)
 * from "the feature is on but nothing has been configured" (table exists,
 * no row resolves). Only the second state is the fail-closed
 * REST_POLICY_MISSING the user asked for. The first state must behave
 * exactly like today — deploying this code ahead of running the migration
 * must never start blocking live roster generation on its own; every write
 * path calls this before calling validateMinimumRest() and skips validation
 * entirely (preserving current behavior) when it returns false.
 */
export async function isRestPolicyFeatureActive(executor: Executor = db): Promise<boolean> {
  return hasTable("wfm_rest_policy", executor);
}

export type RestPolicyScopeType = "organization" | "branch" | "process" | "employee";

/**
 * WARN records the shortfall and lets the roster write proceed; BLOCK refuses it.
 *
 * Owner ruling 2026-08-16 (decision 2): activate the 11-hour rule in WARN first, remediate the
 * 139 NOIDA-2 turnarounds through the warning report, then flip the SAME policy row to BLOCK
 * with no code rewrite. The mode lives on the policy and is resolved once here, so all four
 * roster write paths obey one decision — the ruling is explicit that enforcement must not be
 * weakened separately in generation, manual assignment or bulk upload.
 */
export type RestEnforcementMode = "warn" | "block";

export interface RestPolicy {
  id: string;
  scopeType: RestPolicyScopeType;
  scopeId: string | null;
  minimumRestMinutes: number;
  allowsEmergencyOverride: boolean;
  /**
   * Defaults to "block" whenever the column is missing or holds anything unexpected, so an
   * un-migrated database or a stray value can never silently loosen enforcement.
   */
  enforcementMode: RestEnforcementMode;
}

export interface RestPolicyContext {
  /** Omit for a scope-existence check with no specific employee in mind (e.g.
   *  "has ANY policy ever been configured for this process/branch/org?"
   *  before a generation run starts) — the employee tier is simply skipped. */
  employeeId?: string | null;
  processId?: string | null;
  branchId?: string | null;
  /** The later of the two shifts being compared — resolves which policy
   *  version (effective_from/to) applies. */
  forDate: string;
}

export interface ShiftTimeRef {
  date: string;
  time: string; // "HH:MM" or "HH:MM:SS"
}

export type RestViolationReason = "REST_POLICY_MISSING" | "INSUFFICIENT_REST";

export interface RestValidationResult {
  ok: boolean;
  reason?: RestViolationReason;
  actualRestMinutes?: number;
  requiredRestMinutes?: number;
  policy?: RestPolicy | null;
  /** Only meaningful when reason === "INSUFFICIENT_REST" */
  canOverride?: boolean;
  /** Which neighboring shift the violation is against, for error messaging. */
  against?: "previous" | "next";
  /** The neighboring shift's own date/time — callers need this to log an
   *  emergency override (wfm_rest_override_log's previous_shift_end_at /
   *  next_shift_start_at) without a second findAdjacentShifts lookup. */
  neighborShift?: ShiftTimeRef;
}

function mapPolicyRow(row: RowDataPacket): RestPolicy {
  return {
    id: String(row.id),
    scopeType: row.scope_type as RestPolicyScopeType,
    scopeId: row.scope_id ? String(row.scope_id) : null,
    minimumRestMinutes: Number(row.minimum_rest_minutes),
    allowsEmergencyOverride: Boolean(row.allows_emergency_override),
    // Anything other than an explicit 'warn' is treated as 'block'. A database that has not
    // taken migration 1224 yet returns undefined here, and the safe reading of "I don't know
    // what mode this policy is in" is the stricter one.
    enforcementMode: String(row.enforcement_mode ?? "").toLowerCase() === "warn" ? "warn" : "block",
  };
}

/**
 * Employee approved exception → process → branch/site → organization
 * default. Returns the first (most specific) match, or null if nothing is
 * configured at any level for forDate. Each scope is a single indexed lookup
 * (uq_wfm_rest_policy_scope_window), not a full-table scan.
 */
export async function resolveRestPolicy(ctx: RestPolicyContext, executor: Executor = db): Promise<RestPolicy | null> {
  if (!(await hasTable("wfm_rest_policy", executor))) return null;

  const scopes: { type: RestPolicyScopeType; id: string | null }[] = [];
  if (ctx.employeeId) scopes.push({ type: "employee", id: ctx.employeeId });
  if (ctx.processId) scopes.push({ type: "process", id: ctx.processId });
  if (ctx.branchId) scopes.push({ type: "branch", id: ctx.branchId });
  scopes.push({ type: "organization", id: null });

  for (const scope of scopes) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_rest_policy
        WHERE scope_type = ?
          AND scope_id <=> ?
          AND active_status = 1
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [scope.type, scope.id, ctx.forDate, ctx.forDate]
    );
    if (rows[0]) return mapPolicyRow(rows[0]);
  }
  return null;
}

/** Minutes between two (date, time) points, cross-midnight and
 *  cross-calendar-day safe. UTC construction throughout (Date.UTC), same
 *  timezone-independence pattern as computeScheduledMinutes/dateRange
 *  elsewhere in this module — never a local-timezone Date constructor. */
/** UTC-only day arithmetic, matching the Date.UTC discipline used throughout this module. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The calendar date a shift actually ENDS on.
 *
 * A shift whose end time is not after its start time ran through midnight, so it ends on the
 * following day. Rest was previously measured from the end time placed on the shift's own
 * roster_date, which puts the end of a 21:00-06:00 shift at 06:00 that MORNING — roughly a
 * full day before it really finished. Every gap after a night shift was therefore overstated
 * by about 24 hours and could never breach any threshold.
 *
 * That is not an edge case here: 10 of the 23 configured shift templates cross midnight, and
 * 202 employees sit on 21:00-06:00 alone. Night workers are exactly the population a minimum
 * rest rule exists to protect, and they were the population it could not see.
 */
export function shiftEndDate(rosterDate: string, startTime: string, endTime: string): string {
  const start = startTime.slice(0, 5);
  const end = endTime.slice(0, 5);
  return end <= start ? addDays(rosterDate, 1) : rosterDate;
}

export function restGapMinutes(prev: ShiftTimeRef, next: ShiftTimeRef): number {
  const [py, pm, pd] = prev.date.split("-").map(Number);
  const [ph, pmin] = prev.time.split(":").map(Number);
  const [ny, nm, nd] = next.date.split("-").map(Number);
  const [nh, nmin] = next.time.split(":").map(Number);
  const prevEnd = Date.UTC(py, pm - 1, pd, ph, pmin);
  const nextStart = Date.UTC(ny, nm - 1, nd, nh, nmin);
  return Math.round((nextStart - prevEnd) / 60000);
}

/** Finds the employee's nearest scheduled shift strictly before, and strictly
 *  after, rosterDate (excluding week-off rows and rows missing a time
 *  snapshot — nothing to compare rest against in either case). Assigning or
 *  changing a single day's shift can violate rest with either neighbor, so
 *  both are checked. */
export async function findAdjacentShifts(
  employeeId: string,
  rosterDate: string,
  excludeAssignmentId?: string | null,
  executor: Executor = db
): Promise<{ previous: ShiftTimeRef | null; next: ShiftTimeRef | null }> {
  const excludeClause = excludeAssignmentId ? "AND a.id <> ?" : "";
  const excludeParam = excludeAssignmentId ? [excludeAssignmentId] : [];

  // Times come from the assignment's own snapshot columns when it has them, and otherwise
  // from the shift template it points at.
  //
  // Reading only the snapshot columns made this blind to the real roster: all 1,354
  // cycle-bound assignments in production carry shift_start_time and shift_end_time NULL and
  // hold their times solely in shift_template_id. The 412,032 rows that DO populate the
  // snapshot are a single-window synthetic backfill. So the guard evaluated seed data and
  // skipped every genuine assignment — silently, because a NULL time simply filtered the row
  // out of these two queries and the employee looked like they had no neighbouring shift.
  const [prevRows] = await executor.execute<RowDataPacket[]>(
    `SELECT a.roster_date,
            COALESCE(a.shift_start_time, t.start_time) AS start_time,
            COALESCE(a.shift_end_time,   t.end_time)   AS end_time
       FROM wfm_roster_assignment a
       LEFT JOIN wfm_shift_template t ON t.id = a.shift_template_id
      WHERE a.employee_id = ? AND a.roster_date < ? AND a.is_week_off = 0
        AND COALESCE(a.shift_start_time, t.start_time) IS NOT NULL
        AND COALESCE(a.shift_end_time,   t.end_time)   IS NOT NULL ${excludeClause}
      ORDER BY a.roster_date DESC LIMIT 1`,
    [employeeId, rosterDate, ...excludeParam]
  );
  const [nextRows] = await executor.execute<RowDataPacket[]>(
    `SELECT a.roster_date,
            COALESCE(a.shift_start_time, t.start_time) AS start_time
       FROM wfm_roster_assignment a
       LEFT JOIN wfm_shift_template t ON t.id = a.shift_template_id
      WHERE a.employee_id = ? AND a.roster_date > ? AND a.is_week_off = 0
        AND COALESCE(a.shift_start_time, t.start_time) IS NOT NULL ${excludeClause}
      ORDER BY a.roster_date ASC LIMIT 1`,
    [employeeId, rosterDate, ...excludeParam]
  );

  // The previous shift's END is dated by when it actually finished, not by its roster_date.
  const prev = prevRows[0]
    ? {
        date: shiftEndDate(
          String(prevRows[0].roster_date).slice(0, 10),
          String(prevRows[0].start_time).slice(0, 5),
          String(prevRows[0].end_time).slice(0, 5)
        ),
        time: String(prevRows[0].end_time).slice(0, 5),
      }
    : null;
  // A shift always STARTS on its own roster_date, so no roll is needed here.
  const next = nextRows[0]
    ? { date: String(nextRows[0].roster_date).slice(0, 10), time: String(nextRows[0].start_time).slice(0, 5) }
    : null;
  return { previous: prev, next: next };
}

/**
 * The single entry point every write path (weekly generation, manual
 * assignment, bulk upload, override) should call before committing a shift
 * assignment. Checks the candidate shift against both neighbors and returns
 * the worst outcome — REST_POLICY_MISSING beats INSUFFICIENT_REST beats ok,
 * since a caller that can't even determine the rule should never proceed.
 *
 * candidateShift's date is rosterDate; start/end are "HH:MM"[:SS].
 */
export async function validateMinimumRest(
  ctx: RestPolicyContext & { employeeId: string },
  candidateShift: { startTime: string; endTime: string },
  excludeAssignmentId?: string | null,
  executor: Executor = db
): Promise<RestValidationResult> {
  const policy = await resolveRestPolicy(ctx, executor);
  if (!policy) return { ok: false, reason: "REST_POLICY_MISSING", policy: null };

  const { previous, next } = await findAdjacentShifts(ctx.employeeId, ctx.forDate, excludeAssignmentId, executor);
  const candidateStart: ShiftTimeRef = { date: ctx.forDate, time: candidateShift.startTime.slice(0, 5) };
  // The candidate can itself run through midnight — a 22:00-07:00 shift ends the next morning,
  // which is what the following shift has to be measured against.
  const candidateEnd: ShiftTimeRef = {
    date: shiftEndDate(ctx.forDate, candidateShift.startTime, candidateShift.endTime),
    time: candidateShift.endTime.slice(0, 5),
  };

  if (previous) {
    const gap = restGapMinutes(previous, candidateStart);
    if (gap < policy.minimumRestMinutes) {
      return {
        ok: false, reason: "INSUFFICIENT_REST", against: "previous", neighborShift: previous,
        actualRestMinutes: gap, requiredRestMinutes: policy.minimumRestMinutes,
        policy, canOverride: policy.allowsEmergencyOverride,
      };
    }
  }
  if (next) {
    const gap = restGapMinutes(candidateEnd, next);
    if (gap < policy.minimumRestMinutes) {
      return {
        ok: false, reason: "INSUFFICIENT_REST", against: "next", neighborShift: next,
        actualRestMinutes: gap, requiredRestMinutes: policy.minimumRestMinutes,
        policy, canOverride: policy.allowsEmergencyOverride,
      };
    }
  }
  return { ok: true, requiredRestMinutes: policy.minimumRestMinutes, policy };
}

/**
 * "Has ANY minimum-rest policy ever been configured for this process/branch
 * (falling through to organization)?" — no specific employee in mind. Meant
 * to be called ONCE per generation run / bulk-upload batch, before doing any
 * work, so a wholly-unconfigured policy fails the whole run up front with a
 * clear configuration-required message rather than surfacing as a confusing
 * per-employee REST_POLICY_MISSING deep inside a loop (or worse, being
 * silently skipped one employee at a time). Only meaningful to call once
 * isRestPolicyFeatureActive() is true — see that function's docstring for why
 * the two are kept separate.
 */
/**
 * Should this write be refused, or allowed with a warning recorded?
 *
 * The single place that answers it. A caller asks once and either proceeds or refuses; it never
 * inspects enforcementMode itself, because four paths each reading the mode is four chances to
 * read it differently.
 *
 * REST_POLICY_MISSING always blocks regardless of mode — there is no policy to be lenient
 * about, and a caller that cannot determine the rule must never write. Only a measured
 * INSUFFICIENT_REST can be warned through.
 */
export async function applyRestDecision(
  result: RestValidationResult,
  context: {
    employeeId: string;
    rosterDate: string;
    assignmentId?: string | null;
    planId?: string | null;
  },
  executor: Executor = db,
): Promise<{ allowed: boolean; warned: boolean }> {
  if (result.ok) return { allowed: true, warned: false };
  if (result.reason !== "INSUFFICIENT_REST") return { allowed: false, warned: false };
  if (result.policy?.enforcementMode !== "warn") return { allowed: false, warned: false };

  await recordRestGapWarning(
    {
      employeeId: context.employeeId,
      rosterDate: context.rosterDate,
      actualRestMinutes: result.actualRestMinutes ?? 0,
      requiredRestMinutes: result.requiredRestMinutes ?? 0,
      against: result.against ?? "previous",
      neighborShift: result.neighborShift ?? null,
      assignmentId: context.assignmentId ?? null,
      planId: context.planId ?? null,
    },
    executor,
  );
  return { allowed: true, warned: true };
}

/**
 * Record a rest shortfall that was ALLOWED through because the policy is in WARN mode.
 *
 * Owner ruling 2026-08-16 (decision 2): in WARN the write proceeds, but the violation must
 * persist, carry the actual rest against the required rest, name the conflicting neighbouring
 * assignment, and be visible to WFM review and reporting. It must not silently disappear.
 *
 * Written to wfm_roster_conflict_log rather than a new table — it already carries exactly this
 * shape (employee, roster_date, conflict_type, severity, message, resolution_status) and is the
 * queue WFM review already reads. Severity is 'high': a warned-through shortfall is not
 * informational, it is a breach someone chose to accept and must come back to.
 *
 * Lives here, next to the resolver, so every write path records the same thing the same way.
 * The ruling is explicit that enforcement must not diverge between generation, manual
 * assignment and bulk upload, and a per-path logging helper is how that divergence starts.
 *
 * Non-throwing on purpose: the roster write has already been allowed by the time this is
 * called, and failing it here would turn a warning into a lost assignment. A failure is logged
 * loudly instead.
 */
export async function recordRestGapWarning(
  input: {
    employeeId: string;
    rosterDate: string;
    actualRestMinutes: number;
    requiredRestMinutes: number;
    against: "previous" | "next";
    neighborShift?: ShiftTimeRef | null;
    assignmentId?: string | null;
    planId?: string | null;
  },
  executor: Executor = db,
): Promise<void> {
  const neighbour = input.neighborShift
    ? `${input.neighborShift.date} ${input.neighborShift.time}`
    : "unknown";
  const shortfall = input.requiredRestMinutes - input.actualRestMinutes;
  const message =
    `Only ${input.actualRestMinutes} min rest against the ${input.against} shift ` +
    `(${neighbour}); policy requires ${input.requiredRestMinutes} min — short by ${shortfall} min. ` +
    `Allowed because the minimum-rest policy is in WARN mode.`;

  try {
    await executor.execute(
      `INSERT INTO wfm_roster_conflict_log
         (id, plan_id, assignment_id, employee_id, conflict_date, roster_date,
          conflict_type, severity, description, message, resolved, resolution_status, detected_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, 'REST_GAP_WARNING', 'high', ?, ?, 0, 'open', NOW())`,
      [
        input.planId ?? null,
        input.assignmentId ?? null,
        input.employeeId,
        input.rosterDate,
        input.rosterDate,
        message,
        message,
      ],
    );
  } catch (err) {
    console.error(
      `[rest-policy] REST_GAP_WARNING could not be recorded for employee ${input.employeeId} on ${input.rosterDate}:`,
      err,
    );
  }
}

export async function hasAnyRestPolicyConfigured(
  ctx: { processId?: string | null; branchId?: string | null; forDate: string },
  executor: Executor = db
): Promise<boolean> {
  return (await resolveRestPolicy(ctx, executor)) !== null;
}

export interface RestOverrideInput {
  employeeId: string;
  rosterDate: string;
  previousShiftEndAt: string; // full DATETIME "YYYY-MM-DD HH:MM:SS"
  nextShiftStartAt: string;
  actualRestMinutes: number;
  requiredRestMinutes: number;
  policyId: string | null;
  source: "weekly_generation" | "manual_assignment" | "bulk_upload" | "shift_swap";
  reason: string;
  requestedBy: string;
  approvedBy: string;
}

/** Immutable audit row for an emergency rest override that was actually used
 *  to publish an assignment below the resolved minimum. Insert-only by
 *  design — no update/delete route exists or should ever be added. */
export async function logRestOverride(input: RestOverrideInput, executor: Executor = db): Promise<void> {
  await executor.execute(
    `INSERT INTO wfm_rest_override_log
       (id, employee_id, roster_date, previous_shift_end_at, next_shift_start_at,
        actual_rest_minutes, required_rest_minutes, policy_id, source, reason,
        requested_by, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(), input.employeeId, input.rosterDate, input.previousShiftEndAt, input.nextShiftStartAt,
      input.actualRestMinutes, input.requiredRestMinutes, input.policyId, input.source, input.reason,
      input.requestedBy, input.approvedBy,
    ]
  );
}
