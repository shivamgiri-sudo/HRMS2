/**
 * Post-publication amendment side effects that belong to the Roster Audit Trail:
 *  1. The amendment is recorded in roster_decision_audit, so it actually shows up in the audit trail
 *     (rosterGovernanceService.createAmendment only wrote roster_change_log, so "Logged in the roster
 *     audit trail" was untrue — amendments never appeared in /roster-audit/trails).
 *  2. A WEEK_OFF / SHIFT amendment now keeps roster_daily_assignment.is_week_off in step with the
 *     change log (the service only ever updated shift_template_id, leaving a week-off amendment as a no-op).
 * Best-effort: failures are logged, never thrown — the amendment itself is already committed.
 */
import { db } from '../../db/mysql.js';
import type { AmendmentAssignmentType } from './roster-audit.helpers.js';

export interface AmendmentAuditInput {
  cycleId: string;
  employeeId: string;
  date: string;
  newAssignmentType: AmendmentAssignmentType;
  newShiftId?: string | null;
  reason: string;
  actorUserId: string;
  actorRole?: string | null;
  cycle: { process_id: string; branch_id: string | null; week_start_date: string };
  oldShiftId?: string | null;
}

export async function recordAmendmentInDecisionAudit(a: AmendmentAuditInput): Promise<void> {
  try {
    if (a.newAssignmentType === 'WEEK_OFF') {
      await db.execute(
        `UPDATE roster_daily_assignment SET is_week_off = 1, shift_template_id = NULL, updated_at = NOW()
          WHERE cycle_id = ? AND employee_id = ? AND roster_date = ?`,
        [a.cycleId, a.employeeId, a.date],
      );
    } else if (a.newAssignmentType === 'SHIFT') {
      await db.execute(
        `UPDATE roster_daily_assignment SET is_week_off = 0, updated_at = NOW()
          WHERE cycle_id = ? AND employee_id = ? AND roster_date = ?`,
        [a.cycleId, a.employeeId, a.date],
      );
    }
    const decision = a.newAssignmentType === 'WEEK_OFF' ? 'weekoff_assigned' : 'manual_override';
    await db.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, week_start_date, process_id, branch_id, employee_id, roster_date, decision_type,
          assigned_shift_template_id, is_week_off, rule_applied, override_by, acted_by_role, override_reason, override_at,
          old_value_json, new_value_json)
       VALUES (UUID(), NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'post_publication_amendment', ?, ?, ?, NOW(), ?, ?)`,
      [
        a.cycleId, String(a.cycle.week_start_date).slice(0, 10), a.cycle.process_id, a.cycle.branch_id ?? null,
        a.employeeId, a.date, decision,
        a.newShiftId ?? null, a.newAssignmentType === 'WEEK_OFF' ? 1 : 0,
        a.actorUserId, a.actorRole ?? null, a.reason.trim().slice(0, 500),
        JSON.stringify({ shiftId: a.oldShiftId ?? null }),
        JSON.stringify({ assignmentType: a.newAssignmentType, shiftId: a.newShiftId ?? null }),
      ],
    );
  } catch (err) {
    console.error('[roster-audit] failed to mirror amendment into roster_decision_audit', err);
  }
}
