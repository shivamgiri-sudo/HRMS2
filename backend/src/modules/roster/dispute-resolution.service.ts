/**
 * Manager resolution of a disputed roster_daily_assignment.
 *
 * Extracted from POST /api/roster-gov/assignments/:id/resolve-dispute (roster.governance.routes.ts)
 * so the Roster Requests hub (roster-requests.decide.ts) applies the same resolution through the
 * same code. The route handler is a thin wrapper: every refusal is thrown as a
 * DisputeResolutionError carrying the exact status code and JSON body the handler used to send.
 *
 * Idempotency note: like the original handler, this does NOT refuse an assignment whose dispute is
 * already resolved — a repeat call re-applies the resolution. That is existing behaviour and is
 * preserved here; the hub's decide path performs its own status pre-check.
 *
 * Dispute bridge (shift change only): roster_daily_assignment is the governance table; the roster
 * view and attendance engine read wfm_roster_assignment and RTA is fed from rda by cycle. So a
 * shift change here is payroll-lock checked and minimum-rest checked (both BEFORE any write),
 * mirrored onto the live wfm_roster_assignment row (never inserted), audited, and resynced to RTA
 * for an already-published cycle. Mirror and RTA failures are non-fatal and surface as warnings /
 * rtaResynced=false. An acknowledgement-only resolution skips all of that except the audit row.
 */
import type { RowDataPacket } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { hasProcessScope } from "../../shared/accessGuard.js";
import { ORG_WIDE_EXEMPT_ROLES, hasAnyRole } from "../../shared/scopeAccess.js";
import { userCanAccessProcess } from "../wfm/branch-scope.js";
import { notifyRosterRequest } from "../roster-requests/roster-requests.notify.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { validateMinimumRest, isRestPolicyFeatureActive, logRestOverride } from "../wfm/rest-policy.service.js";
import { checkAssignmentDateNotLocked, checkEmployeeDateNotLocked } from "./roster-lock-guard.js";
import { rtaSyncService } from "./rta-sync.service.js";

export const ROSTER_OWNERS = ["manager", "wfm"];

// Dispute resolution legitimately happens after publish (a dispute is raised against an
// already-published/acknowledged assignment, which bulkUpsertAssignments's narrower
// EDITABLE_ASSIGNMENT_STATUSES — draft/submitted/reviewed only — would wrongly forbid).
// What resolve-dispute must NOT be able to touch is a cycle whose attendance is already
// locked or whose payroll has moved on: those three statuses are excluded here, matching
// the concern bulkUpsertAssignments's own status gate exists for, without blocking the
// normal published/acknowledged dispute flow this route is actually for.
export const DISPUTE_LOCKED_STATUSES = new Set(["attendance_locked", "payroll_input_ready", "closed"]);

// Cycle statuses that rta-sync.service's syncCycleToRta accepts (it 409s on anything earlier, i.e. an
// unpublished cycle) minus DISPUTE_LOCKED_STATUSES, which never reach the write below anyway.
export const RTA_RESYNC_STATUSES = new Set(["published", "acknowledged", "active", "variance_review"]);

export const NO_LIVE_ROW_WARNING = "no live roster row to mirror";

/**
 * Roster ownership: org-wide roles, or a manager/wfm process scope the user can actually reach.
 * roster.governance.routes.ts's canOwnRoster(req, ...) delegates here.
 */
export async function canOwnRosterForUser(userId: string, processId: string, branchId?: string | null): Promise<boolean> {
  // Owner ruling 2026-10-01: only ORG_WIDE_EXEMPT_ROLES bypass the process/branch scope.
  if (await hasAnyRole(userId, ...ORG_WIDE_EXEMPT_ROLES)) return true;
  return (await hasProcessScope(userId, processId, branchId, ...ROSTER_OWNERS)) && (await userCanAccessProcess(userId, processId, branchId));
}

export interface DisputeResolutionError extends Error {
  statusCode: number;
  body: Record<string, unknown>;
}

function fail(statusCode: number, body: Record<string, unknown>): DisputeResolutionError {
  return Object.assign(new Error(String(body.error ?? body.message ?? "Request failed")), { statusCode, body });
}

export function isDisputeResolutionError(err: unknown): err is DisputeResolutionError {
  return !!err && typeof err === "object" && typeof (err as any).statusCode === "number" && !!(err as any).body;
}

export interface ResolveDisputeParams {
  assignmentId: string;
  userId: string;
  /** Free-text resolution; required (non-empty after trim). Typed loosely: it is the raw request body field. */
  resolution: any;
  /** When given, the assignment moves to this shift; otherwise the original shift is kept. */
  newShiftTemplateId?: string | null;
  req?: Request;
  /**
   * Emergency rest override, honoured exactly like the swap path (applyApprovedSwap): only for an
   * INSUFFICIENT_REST result whose policy allows emergency override; logged to wfm_rest_override_log.
   */
  restOverrideReason?: string | null;
  /** Authorization check; defaults to canOwnRosterForUser(userId, ...). */
  canOwn?: (processId: string, branchId: string | null) => Promise<boolean>;
}

export interface ResolveDisputeResult {
  assignmentId: string;
  employeeId: string;
  rosterDate: string;
  cycleId: string | null;
  previousShiftTemplateId: string | null;
  shiftTemplateId: string | null;
  resolution: string;
  /** True when the new shift was copied onto the live wfm_roster_assignment row. */
  mirrored: boolean;
  /** True when RTA was resynced for the cycle after a shift change. */
  rtaResynced: boolean;
  /** True when an emergency rest override was used to apply the new shift. */
  restOverrideUsed: boolean;
  warnings: string[];
}

export async function resolveDispute(p: ResolveDisputeParams): Promise<ResolveDisputeResult> {
  const { resolution, userId, assignmentId } = p;
  const new_shift_template_id = p.newShiftTemplateId;
  if (!resolution?.trim()) throw fail(400, { error: "dispute_resolution is required" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rda.*, wrc.process_id, wrc.branch_id, wrc.status AS cycle_status, e.branch_id AS employee_branch_id
       FROM roster_daily_assignment rda
       JOIN weekly_roster_cycle wrc ON wrc.id = rda.cycle_id
       LEFT JOIN employees e ON e.id = rda.employee_id
      WHERE rda.id = ? LIMIT 1`,
    [assignmentId]
  );
  const assignment = rows[0];
  if (!assignment) throw fail(404, { error: "Assignment not found" });

  const canOwn = p.canOwn ?? ((processId: string, branchId: string | null) => canOwnRosterForUser(userId, processId, branchId));
  if (!(await canOwn(assignment.process_id, assignment.branch_id))) {
    throw fail(403, { success: false, message: "Forbidden: roster ownership required to resolve disputes" });
  }

  // Every other assignment-mutating path in roster.governance.routes.ts checks cycle status
  // before writing (see bulkUpsertAssignments's EDITABLE_ASSIGNMENT_STATUSES); this route
  // never did, so a shift could be silently changed on an assignment whose cycle was
  // already attendance-locked or payroll-closed.
  if (DISPUTE_LOCKED_STATUSES.has(assignment.cycle_status)) {
    throw fail(409, {
      error: `Cannot resolve a dispute on a ${assignment.cycle_status} cycle — attendance/payroll has already moved on`,
    });
  }

  const rosterDate = String(assignment.roster_date).slice(0, 10); // pool uses dateStrings: true
  const shiftChanged = !!new_shift_template_id && new_shift_template_id !== assignment.shift_template_id;
  const warnings: string[] = [];
  let liveRow: RowDataPacket | null = null;
  let template: RowDataPacket | null = null;
  let restOverrideUsed = false;

  // Dispute bridge, part 1 (shift change only): everything that can refuse runs BEFORE any write.
  if (shiftChanged) {
    const [tplRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, start_time, end_time FROM wfm_shift_template WHERE id = ? LIMIT 1",
      [new_shift_template_id]
    );
    template = tplRows[0] ?? null;
    if (!template) throw fail(400, { error: "Shift template not found" });

    const [liveRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, is_week_off FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date = ? LIMIT 1",
      [assignment.employee_id, rosterDate]
    );
    liveRow = liveRows[0] ?? null;

    // Payroll lock: the live-row guard when there is one, else the same lock by employee/date.
    const lock = liveRow
      ? await checkAssignmentDateNotLocked(db as any, String(liveRow.id))
      : await checkEmployeeDateNotLocked(db as any, assignment.employee_id, rosterDate);
    if (lock.blocked) throw fail(409, { error: lock.error });

    // Minimum rest for the NEW shift — same rules as the swap path (applyApprovedSwap).
    if (template.start_time && template.end_time && (await isRestPolicyFeatureActive(db as any))) {
      const startTime = String(template.start_time).slice(0, 5);
      const endTime = String(template.end_time).slice(0, 5);
      const result = await validateMinimumRest(
        { employeeId: assignment.employee_id, processId: assignment.process_id ?? null, branchId: assignment.employee_branch_id ?? assignment.branch_id ?? null, forDate: rosterDate },
        { startTime, endTime },
        liveRow ? String(liveRow.id) : null
      );
      if (!result.ok) {
        const overrideReason = typeof p.restOverrideReason === "string" ? p.restOverrideReason.trim() : "";
        if (result.reason === "REST_POLICY_MISSING" || !result.canOverride || !overrideReason) {
          throw fail(409, {
            error: `Dispute resolution would leave the employee with insufficient rest (${result.reason}${result.reason === "INSUFFICIENT_REST" ? `: ${result.actualRestMinutes}min actual vs ${result.requiredRestMinutes}min required` : ""}).`,
            code: result.reason,
          });
        }
        restOverrideUsed = true;
        if (result.neighborShift) {
          const againstPrevious = result.against === "previous";
          await logRestOverride({
            employeeId: assignment.employee_id,
            rosterDate,
            previousShiftEndAt: againstPrevious ? `${result.neighborShift.date} ${result.neighborShift.time}:00` : `${rosterDate} ${endTime}:00`,
            nextShiftStartAt: againstPrevious ? `${rosterDate} ${startTime}:00` : `${result.neighborShift.date} ${result.neighborShift.time}:00`,
            actualRestMinutes: result.actualRestMinutes!,
            requiredRestMinutes: result.requiredRestMinutes!,
            policyId: result.policy?.id ?? null,
            source: "dispute_resolution",
            reason: overrideReason,
            requestedBy: assignment.employee_id,
            approvedBy: userId,
          });
        }
      }
    }
  }

  const setClause = new_shift_template_id
    ? "acknowledgement_status = 'acknowledged', dispute_resolved_by = ?, dispute_resolved_at = NOW(), dispute_resolution = ?, shift_template_id = ?"
    : "acknowledgement_status = 'acknowledged', dispute_resolved_by = ?, dispute_resolved_at = NOW(), dispute_resolution = ?";
  // dispute_resolved_at uses NOW(): the pool session timezone is +05:30, matching every other DB-written timestamp.
  // dispute_resolved_by has FK -> employees(id): store the resolver's EMPLOYEE id (NULL when none).
  // The acting user id stays in the audit log below.
  let resolverEmployeeId: string | null = null;
  if (userId && userId !== "system") {
    const [empRows] = await db.execute<RowDataPacket[]>("SELECT id FROM employees WHERE user_id = ? LIMIT 1", [userId]);
    resolverEmployeeId = Array.isArray(empRows) && empRows[0]?.id ? String(empRows[0].id) : null;
  }
  const setParams = new_shift_template_id
    ? [resolverEmployeeId, resolution.trim(), new_shift_template_id, assignmentId]
    : [resolverEmployeeId, resolution.trim(), assignmentId];

  await db.execute(`UPDATE roster_daily_assignment SET ${setClause} WHERE id = ?`, setParams);

  // Dispute bridge, part 2: mirror onto the live roster (roster view / attendance engine read
  // wfm_roster_assignment, not roster_daily_assignment). Never inserts. The time snapshot columns
  // are refreshed only where the row already carries a snapshot (the attendance engine reads the
  // snapshot before the template), so a stale snapshot cannot outlive the shift change.
  let mirrored = false;
  if (shiftChanged) {
    if (!liveRow) {
      warnings.push(NO_LIVE_ROW_WARNING);
    } else {
      try {
        await db.execute(
          `UPDATE wfm_roster_assignment
              SET shift_template_id = ?,
                  shift_start_time = IF(shift_start_time IS NULL, NULL, ?),
                  shift_end_time = IF(shift_end_time IS NULL, NULL, ?)
            WHERE employee_id = ? AND roster_date = ?`,
          [new_shift_template_id, template!.start_time ?? null, template!.end_time ?? null, assignment.employee_id, rosterDate]
        );
        mirrored = true;
      } catch (err) {
        console.error("[dispute-resolution] mirror to wfm_roster_assignment failed (dispute already resolved):", { assignmentId, err });
        warnings.push("live roster mirror failed");
      }
    }
  }

  await logSensitiveAction({
    actor_user_id: userId,
    action_type: "ROSTER_DISPUTE_RESOLVED",
    module_key: "WFM",
    entity_type: "roster_daily_assignment",
    entity_id: String(assignmentId),
    change_summary: {
      before_shift_template_id: assignment.shift_template_id ?? null,
      after_shift_template_id: new_shift_template_id || assignment.shift_template_id || null,
      newShiftTemplateId: new_shift_template_id || null,
      mirrored,
      restOverrideUsed,
      roster_date: rosterDate,
      cycle_id: assignment.cycle_id ?? null,
    },
    req: p.req,
  });

  // Dispute bridge, part 3: rta-sync reads roster_daily_assignment by cycle, so resync a cycle that
  // was already published to RTA. Non-fatal: the resolution is committed.
  let rtaResynced = false;
  if (shiftChanged && assignment.cycle_id && RTA_RESYNC_STATUSES.has(assignment.cycle_status)) {
    try {
      await rtaSyncService.syncCycleToRta(assignment.cycle_id, "manual_resync", userId, p.req);
      rtaResynced = true;
    } catch (err) {
      console.error("[dispute-resolution] RTA resync failed (dispute already resolved):", { assignmentId, cycleId: assignment.cycle_id, err });
    }
  }
  await notifyRosterRequest({
    employeeIds: [assignment.employee_id],
    kind: "dispute",
    sourceId: String(assignmentId),
    title: "Roster dispute resolved",
    description: `Your dispute for ${rosterDate} was resolved: ${resolution.trim()}`.slice(0, 1000),
  });

  return {
    assignmentId: String(assignmentId),
    employeeId: String(assignment.employee_id),
    rosterDate,
    cycleId: assignment.cycle_id ?? null,
    previousShiftTemplateId: assignment.shift_template_id ?? null,
    shiftTemplateId: new_shift_template_id || assignment.shift_template_id || null,
    resolution: resolution.trim(),
    mirrored,
    rtaResynced,
    restOverrideUsed,
    warnings,
  };
}
