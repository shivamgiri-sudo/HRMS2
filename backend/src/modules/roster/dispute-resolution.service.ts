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
 */
import type { RowDataPacket } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { hasProcessScope } from "../../shared/accessGuard.js";
import { ORG_WIDE_EXEMPT_ROLES, hasAnyRole } from "../../shared/scopeAccess.js";
import { userCanAccessProcess } from "../wfm/branch-scope.js";
import { notifyRosterRequest } from "../roster-requests/roster-requests.notify.js";

export const ROSTER_OWNERS = ["manager", "wfm"];

// Dispute resolution legitimately happens after publish (a dispute is raised against an
// already-published/acknowledged assignment, which bulkUpsertAssignments's narrower
// EDITABLE_ASSIGNMENT_STATUSES — draft/submitted/reviewed only — would wrongly forbid).
// What resolve-dispute must NOT be able to touch is a cycle whose attendance is already
// locked or whose payroll has moved on: those three statuses are excluded here, matching
// the concern bulkUpsertAssignments's own status gate exists for, without blocking the
// normal published/acknowledged dispute flow this route is actually for.
export const DISPUTE_LOCKED_STATUSES = new Set(["attendance_locked", "payroll_input_ready", "closed"]);

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
}

export async function resolveDispute(p: ResolveDisputeParams): Promise<ResolveDisputeResult> {
  const { resolution, userId, assignmentId } = p;
  const new_shift_template_id = p.newShiftTemplateId;
  if (!resolution?.trim()) throw fail(400, { error: "dispute_resolution is required" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rda.*, wrc.process_id, wrc.branch_id, wrc.status AS cycle_status
       FROM roster_daily_assignment rda
       JOIN weekly_roster_cycle wrc ON wrc.id = rda.cycle_id
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

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const setClause = new_shift_template_id
    ? "acknowledgement_status = 'acknowledged', dispute_resolved_by = ?, dispute_resolved_at = ?, dispute_resolution = ?, shift_template_id = ?"
    : "acknowledgement_status = 'acknowledged', dispute_resolved_by = ?, dispute_resolved_at = ?, dispute_resolution = ?";
  const setParams = new_shift_template_id
    ? [userId, now, resolution.trim(), new_shift_template_id, assignmentId]
    : [userId, now, resolution.trim(), assignmentId];

  await db.execute(`UPDATE roster_daily_assignment SET ${setClause} WHERE id = ?`, setParams);
  await notifyRosterRequest({
    employeeIds: [assignment.employee_id],
    kind: "dispute",
    sourceId: String(assignmentId),
    title: "Roster dispute resolved",
    description: `Your dispute for ${String(assignment.roster_date).slice(0, 10)} was resolved: ${resolution.trim()}`.slice(0, 1000),
  });

  return {
    assignmentId: String(assignmentId),
    employeeId: String(assignment.employee_id),
    rosterDate: String(assignment.roster_date).slice(0, 10),
    cycleId: assignment.cycle_id ?? null,
    previousShiftTemplateId: assignment.shift_template_id ?? null,
    shiftTemplateId: new_shift_template_id || assignment.shift_template_id || null,
    resolution: resolution.trim(),
  };
}
