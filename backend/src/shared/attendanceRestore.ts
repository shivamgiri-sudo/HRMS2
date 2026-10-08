import type { PoolConnection } from "mysql2/promise";

/**
 * Putting one attendance day back to its pre-approval state.
 *
 * Shared by the discard module and by leave.service's own cancel/reject branch,
 * so an approval reversed through either route lands in the same place. Keeping
 * it here rather than in the discard module is deliberate: leave cancellation is
 * an employee-facing operation and should not have to import a privileged
 * admin module to undo its own write.
 */

export type RestoreMode =
  | "snapshot"    // exact restore from the pre-approval snapshot
  | "delete"      // no attendance row existed before the approval; remove the one it created
  | "partial"     // only old_attendance_status / old_lwp_value were saved
  | "rederive"    // nothing usable was saved; the attendance engine rebuilds the day
  | "skip_locked" // another correction owns the row — never overwritten
  | "skip_owned"; // the row now points at a different regularization

export interface DateRestorePlan {
  date: string;
  currentStatus: string | null;
  currentLwp: number | null;
  mode: RestoreMode;
  restoredStatus: string | null;
  restoredLwp: number | null;
  note?: string;
  /**
   * Rows the write actually touched, filled in by applyRestore. Counts reported
   * to the caller derive from this rather than from the plan: a plan says what
   * SHOULD happen, and reporting it as though it did is how a discard came to
   * claim "1 date deleted" while the row was still sitting there.
   */
  appliedRows?: number;
}

export type SnapshotEntry = {
  row_existed: number;
  snapshot: Record<string, unknown> | null;
};

/**
 * Every attendance_daily_record column the snapshot restores verbatim.
 * Identity columns (id, employee_id, record_date) and the row's own timestamps
 * are deliberately absent — restoring those would rewrite the row's identity.
 */
export const SNAPSHOT_RESTORE_COLUMNS = [
  "attendance_status", "lwp_value", "attendance_source", "source_system",
  "source_record_date", "source_reference", "dialler_minutes", "biometric_minutes",
  "raw_minutes", "clock_in_time", "clock_out_time", "work_mode", "late_mark",
  "late_by_minutes", "apr_status", "biometric_status", "mismatch_flag",
  "process_id", "branch_id", "rule_config_id", "regularization_id", "override_by",
  "override_reason", "is_locked", "processed_at", "old_attendance_status",
  "old_lwp_value", "status_change_reason", "status_changed_by", "status_changed_at",
];

/**
 * Attendance columns a regularization approval overwrites but never saved before
 * migration 1023. Reported to the caller on any non-snapshot restore so the UI
 * can say what it could not put back rather than implying a clean revert.
 */
export const UNRECOVERABLE_WITHOUT_SNAPSHOT = [
  "clock_in_time", "clock_out_time", "raw_minutes", "dialler_minutes",
  "biometric_minutes", "attendance_source", "source_system", "source_record_date",
  "source_reference", "late_mark", "late_by_minutes", "biometric_status",
  "apr_status", "mismatch_flag", "override_reason",
];

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Name whatever currently holds a locked attendance row.
 *
 * "Locked by a correction or payroll process" told the reviewer their reversal did nothing
 * and gave them no way forward — reported live on 2026-09-03, where an approved leave and an
 * approved regularization sat on the SAME day and the regularization held the lock, so
 * discarding the leave silently changed nothing and read as an error. The row already
 * carries who took it; saying so turns a dead end into the next step.
 */
function describeLockHolder(adr: any): string {
  const trim = (v: unknown) => String(v ?? "").trim().slice(0, 80);

  if (adr?.regularization_id) {
    return "an approved regularization or attendance dispute on the same day — discard that one first";
  }
  if (adr?.override_by) {
    const why = trim(adr.override_reason);
    return why ? `a manual attendance change (${why})` : "a manual attendance change";
  }
  const reason = trim(adr?.status_change_reason);
  return reason ? `another correction (${reason})` : "another correction or a payroll process";
}

/**
 * Decide, without writing anything, how one regularization/dispute date is put
 * back. Preview and execution both call this, so what the dialog promises and
 * what the transaction does cannot drift apart.
 */
export function planRegularizationRestore(
  regId: string,
  sessionDate: string,
  adr: any | undefined,
  snapshot: SnapshotEntry | undefined
): DateRestorePlan {
  const currentStatus = adr ? String(adr.attendance_status ?? "") : null;
  const currentLwp = adr ? num(adr.lwp_value) : null;
  const base = { date: sessionDate, currentStatus, currentLwp };

  if (!adr) {
    return { ...base, mode: "delete", restoredStatus: null, restoredLwp: null,
      note: "No attendance row exists for this date; nothing to restore." };
  }

  // Another correction has taken ownership since. Never overwrite it — that would
  // silently destroy a newer, valid correction.
  const ownedByThis = String(adr.regularization_id ?? "") === regId;
  if (adr.regularization_id && !ownedByThis) {
    return { ...base, mode: "skip_owned", restoredStatus: currentStatus, restoredLwp: currentLwp,
      note: "A later correction now owns this attendance row; it was left untouched." };
  }
  if (Number(adr.is_locked ?? 0) === 1 && !ownedByThis) {
    return { ...base, mode: "skip_locked", restoredStatus: currentStatus, restoredLwp: currentLwp,
      note: `Attendance row is locked by ${describeLockHolder(adr)}; it was left untouched.` };
  }

  if (snapshot) {
    if (snapshot.row_existed === 0) {
      return { ...base, mode: "delete", restoredStatus: null, restoredLwp: null,
        note: "No attendance row existed before the approval; the row it created is removed." };
    }
    const snap = snapshot.snapshot ?? {};
    return { ...base, mode: "snapshot",
      restoredStatus: snap.attendance_status != null ? String(snap.attendance_status) : null,
      restoredLwp: num(snap.lwp_value) };
  }

  // No snapshot: this approval predates migration 1023.
  // attendance_daily_record.attendance_status is NOT NULL DEFAULT 'unreconciled'
  // (verified live: 0 NULLs across 112,609 rows), and reviewRegularization writes
  // old_attendance_status from `existing?.attendance_status ?? null`. So a NULL
  // there, on a row this regularization owns, can only mean the INSERT branch ran
  // — no row existed before, and the correct undo is DELETE, not a status reset.
  const wroteByThisApproval =
    ownedByThis && String(adr.status_change_reason ?? "").startsWith("Regularization approved");

  if (adr.old_attendance_status != null) {
    return { ...base, mode: "partial",
      restoredStatus: String(adr.old_attendance_status),
      restoredLwp: num(adr.old_lwp_value),
      note: "Approved before pre-state snapshots existed; status and LWP are restored, then the attendance engine recomputes the day from source data." };
  }
  if (wroteByThisApproval) {
    return { ...base, mode: "delete", restoredStatus: null, restoredLwp: null,
      note: "No attendance row existed before this approval (inferred from the pre-snapshot audit columns); the row it created is removed." };
  }
  return { ...base, mode: "rederive", restoredStatus: null, restoredLwp: null,
    note: "No pre-approval state was recorded; the attendance engine recomputes this day from biometric/dialler source data." };
}

/** Same, for one calendar day of an approved leave. */
export function planLeaveRestore(
  date: string,
  adr: any | undefined,
  snapshot: SnapshotEntry | undefined
): DateRestorePlan {
  const currentStatus = adr ? String(adr.attendance_status ?? "") : null;
  const currentLwp = adr ? num(adr.lwp_value) : null;
  const base = { date, currentStatus, currentLwp };

  if (!adr) {
    return { ...base, mode: "delete", restoredStatus: null, restoredLwp: null,
      note: "No attendance row exists for this date." };
  }
  if (Number(adr.is_locked ?? 0) === 1) {
    return { ...base, mode: "skip_locked", restoredStatus: currentStatus, restoredLwp: currentLwp,
      note: `Attendance row is locked by ${describeLockHolder(adr)}; it was left untouched.` };
  }
  // Only days the approval actually marked are reverted. A day already changed to
  // something else since is left alone.
  if (currentStatus !== "leave_approved") {
    return { ...base, mode: "skip_owned", restoredStatus: currentStatus, restoredLwp: currentLwp,
      note: "This day is no longer marked as approved leave; it was left untouched." };
  }
  if (snapshot) {
    if (snapshot.row_existed === 0) {
      return { ...base, mode: "delete", restoredStatus: null, restoredLwp: null,
        note: "No attendance row existed before the approval; the row it created is removed." };
    }
    const snap = snapshot.snapshot ?? {};
    return { ...base, mode: "snapshot",
      restoredStatus: snap.attendance_status != null ? String(snap.attendance_status) : null,
      restoredLwp: num(snap.lwp_value) };
  }
  // Pre-snapshot leave. Deliberately NOT 'absent' + lwp 1.00: the approval wrote
  // every calendar day including weekends and holidays, so blanket-marking them
  // absent invents unpaid days the leave never covered.
  return { ...base, mode: "rederive", restoredStatus: null, restoredLwp: null,
    note: "Approved before pre-state snapshots existed; the attendance engine recomputes this day (week-off and holiday are resolved correctly)." };
}

/** Apply a set of plans inside the caller's open transaction. */
export async function applyRestore(
  conn: PoolConnection,
  employeeId: string,
  plans: DateRestorePlan[],
  snapshots: Map<string, SnapshotEntry>,
  actorUserId: string,
  reasonText: string
): Promise<void> {
  for (const plan of plans) {
    if (plan.mode === "skip_locked" || plan.mode === "skip_owned") continue;

    if (plan.mode === "delete") {
      // No is_locked guard. A regularization approval always sets is_locked = 1,
      // so `AND is_locked = 0` meant this DELETE could never fire for the exact
      // case it exists to handle — the row it created stayed behind while the
      // result claimed it had been removed.
      //
      // Safe without the guard because the planner has already established
      // ownership: it only returns `delete` when the row belongs to this
      // approval, and returns skip_locked / skip_owned for anything a different
      // correction owns.
      const [res] = await conn.execute(
        `DELETE FROM attendance_daily_record
          WHERE employee_id = ? AND record_date = ?`,
        [employeeId, plan.date]
      );
      plan.appliedRows = Number((res as any)?.affectedRows ?? 0);
      continue;
    }

    if (plan.mode === "snapshot") {
      const snap = snapshots.get(plan.date)?.snapshot ?? {};
      const cols = SNAPSHOT_RESTORE_COLUMNS.filter((c) => c in snap);
      if (cols.length === 0) continue;
      const setSql = cols.map((c) => `${c} = ?`).join(", ");
      const [res] = await conn.execute(
        `UPDATE attendance_daily_record
            SET ${setSql}
          WHERE employee_id = ? AND record_date = ?`,
        [...cols.map((c) => (snap as any)[c] ?? null), employeeId, plan.date]
      );
      plan.appliedRows = Number((res as any)?.affectedRows ?? 0);
      continue;
    }

    if (plan.mode === "partial") {
      // Restore what was saved and hand ownership back, so the engine may
      // recompute the day. is_locked = 0 is essential: every engine write is
      // guarded by IF(is_locked = 0, ...), so a row left locked would be frozen
      // and never recomputed again.
      const [res] = await conn.execute(
        `UPDATE attendance_daily_record
            SET attendance_status = ?, lwp_value = ?,
                regularization_id = NULL, override_by = NULL, override_reason = NULL,
                old_attendance_status = NULL, old_lwp_value = NULL,
                is_locked = 0,
                status_change_reason = ?, status_changed_by = ?, status_changed_at = NOW()
          WHERE employee_id = ? AND record_date = ?`,
        [plan.restoredStatus, plan.restoredLwp ?? 0, reasonText, actorUserId, employeeId, plan.date]
      );
      plan.appliedRows = Number((res as any)?.affectedRows ?? 0);
      continue;
    }

    // rederive — neutralise and unlock; the engine rebuilds the day after commit.
    const [res] = await conn.execute(
      `UPDATE attendance_daily_record
          SET attendance_status = 'unreconciled', lwp_value = 0.00,
              regularization_id = NULL, override_by = NULL, override_reason = NULL,
              old_attendance_status = NULL, old_lwp_value = NULL,
              is_locked = 0,
              status_change_reason = ?, status_changed_by = ?, status_changed_at = NOW()
        WHERE employee_id = ? AND record_date = ?`,
      [reasonText, actorUserId, employeeId, plan.date]
    );
    plan.appliedRows = Number((res as any)?.affectedRows ?? 0);
  }
}

/** Re-run the attendance engine, after commit, for the days that need rebuilding. */
export async function rederiveDates(
  employeeId: string,
  plans: DateRestorePlan[]
): Promise<string[]> {
  const warnings: string[] = [];
  const dates = plans.filter((p) => p.mode === "rederive" || p.mode === "partial").map((p) => p.date);
  if (dates.length === 0) return warnings;
  try {
    const { attendanceEngineService } = await import("../modules/wfm/attendance-engine.service.js");
    for (const date of dates) {
      try {
        const result = await attendanceEngineService.processEmployee(employeeId, date);
        await attendanceEngineService.upsertDailyRecord(result, "discard_service");
      } catch (err: any) {
        warnings.push(`Attendance could not be recomputed for ${date}: ${err?.message ?? String(err)}`);
      }
    }
  } catch (err: any) {
    warnings.push(`Attendance engine unavailable: ${err?.message ?? String(err)}`);
  }
  return warnings;
}

export function summariseModes(plans: DateRestorePlan[]): string {
  const modes = new Set(plans.map((p) => p.mode));
  if (modes.size === 0) return "none";
  if (modes.size === 1) return [...modes][0];
  return "mixed";
}
