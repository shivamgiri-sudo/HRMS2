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

export interface RestPolicy {
  id: string;
  scopeType: RestPolicyScopeType;
  scopeId: string | null;
  minimumRestMinutes: number;
  allowsEmergencyOverride: boolean;
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
  const excludeClause = excludeAssignmentId ? "AND id <> ?" : "";
  const excludeParam = excludeAssignmentId ? [excludeAssignmentId] : [];

  const [prevRows] = await executor.execute<RowDataPacket[]>(
    `SELECT roster_date, shift_end_time FROM wfm_roster_assignment
      WHERE employee_id = ? AND roster_date < ? AND is_week_off = 0
        AND shift_end_time IS NOT NULL ${excludeClause}
      ORDER BY roster_date DESC LIMIT 1`,
    [employeeId, rosterDate, ...excludeParam]
  );
  const [nextRows] = await executor.execute<RowDataPacket[]>(
    `SELECT roster_date, shift_start_time FROM wfm_roster_assignment
      WHERE employee_id = ? AND roster_date > ? AND is_week_off = 0
        AND shift_start_time IS NOT NULL ${excludeClause}
      ORDER BY roster_date ASC LIMIT 1`,
    [employeeId, rosterDate, ...excludeParam]
  );

  const prev = prevRows[0]
    ? { date: String(prevRows[0].roster_date).slice(0, 10), time: String(prevRows[0].shift_end_time).slice(0, 5) }
    : null;
  const next = nextRows[0]
    ? { date: String(nextRows[0].roster_date).slice(0, 10), time: String(nextRows[0].shift_start_time).slice(0, 5) }
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
  const candidateStart: ShiftTimeRef = { date: ctx.forDate, time: candidateShift.startTime };
  const candidateEnd: ShiftTimeRef = { date: ctx.forDate, time: candidateShift.endTime };

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
