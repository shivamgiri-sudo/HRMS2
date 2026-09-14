/**
 * Roster notifications — the first real wiring of the notification gateway.
 *
 * Until this file, the gateway had exactly one caller (tat-escalation.worker.ts), so 45 of
 * the 48 catalogued events could never fire. This wires the roster family.
 *
 * Everything here is fire-and-forget and swallows its own errors: publishing a roster must
 * never fail because a mail server is down. It mirrors how the existing SMS blast in
 * roster.governance.service.ts:300 already behaves, and sits alongside it rather than
 * replacing it — the SMS path is an existing working flow (CLAUDE.md rule 3).
 *
 * Nothing sends today: roster_published ships enabled=0, dispatch_mode='shadow'
 * (migration 1022). In shadow the gateway resolves recipients, runs the deny-list and
 * records a claim without calling the provider — which is exactly the evidence you review
 * before switching it live.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { notificationGateway } from '../communication/notification.gateway.js';

interface RosterRecipientRow extends RowDataPacket {
  employee_id: string;
  employee_code: string | null;
  full_name: string | null;
  /** Working days in the cycle — excludes week-offs and holidays. */
  shifts: number;
  week_offs: number;
  holidays: number;
  /** From wfm_shift_template.night_shift. */
  nights: number;
  /** Assignments whose shift template could not be resolved. */
  unresolved_shifts: number;
  first_date: string | null;
  last_date: string | null;
}

/**
 * Per-employee roster summary for one cycle.
 *
 * The join is to `wfm_shift_template`, which is what
 * roster_daily_assignment.shift_template_id actually references (verified against the live
 * FK). `wfm_shift` is a different, similarly-named table — joining it would match nothing
 * and silently report zero night shifts for everyone.
 */
async function loadRosterSummaries(cycleId: string): Promise<RosterRecipientRow[]> {
  const [rows] = await db.execute<RosterRecipientRow[]>(
    `SELECT rda.employee_id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS full_name,
            SUM(CASE WHEN COALESCE(rda.is_week_off,0) = 0
                      AND COALESCE(rda.is_holiday,0) = 0 THEN 1 ELSE 0 END) AS shifts,
            SUM(COALESCE(rda.is_week_off, 0))                              AS week_offs,
            SUM(COALESCE(rda.is_holiday, 0))                               AS holidays,
            SUM(COALESCE(t.night_shift, 0))                                AS nights,
            SUM(CASE WHEN rda.shift_template_id IS NOT NULL
                      AND t.id IS NULL THEN 1 ELSE 0 END)                  AS unresolved_shifts,
            MIN(rda.roster_date)                                           AS first_date,
            MAX(rda.roster_date)                                           AS last_date
       FROM roster_daily_assignment rda
       JOIN employees e            ON e.id = rda.employee_id AND e.active_status = 1
       LEFT JOIN wfm_shift_template t ON t.id = rda.shift_template_id
      WHERE rda.cycle_id = ?
      GROUP BY rda.employee_id, e.employee_code, e.full_name
      ORDER BY e.employee_code`,
    [cycleId],
  );
  return rows;
}

export interface RosterCycleContext {
  id: string;
  branch_id?: string | null;
  process_id?: string | null;
  week_start_date?: string | null;
  week_end_date?: string | null;
  ack_deadline?: string | null;
}

export interface RosterNotifyResult {
  employees: number;
  shadow: number;
  sent: number;
  skipped: number;
}

/**
 * One notification per rostered employee — each person's shift list is personal, so this
 * is genuinely per-employee rather than a broadcast.
 *
 * Note the volume: a 400-person cycle produces 400 notifications. The gateway's per-event
 * daily cap (max_per_day, default 500 in migration 1022) will throttle a large publish and
 * report the remainder rather than dropping it silently. Raise that cap deliberately for
 * roster_published before going live at full branch scale.
 */
export async function notifyRosterPublished(cycle: RosterCycleContext): Promise<RosterNotifyResult> {
  const result: RosterNotifyResult = { employees: 0, shadow: 0, sent: 0, skipped: 0 };
  const summaries = await loadRosterSummaries(cycle.id);
  result.employees = summaries.length;

  const weekLabel = cycle.week_start_date
    ? `${String(cycle.week_start_date).slice(0, 10)} to ${String(cycle.week_end_date ?? '').slice(0, 10)}`.trim()
    : cycle.id;

  for (const s of summaries) {
    try {
      const outcome = await notificationGateway.notify({
        eventCode: 'roster_published',
        // One notification per employee per cycle, no matter how often publish is retried
        // or how many times a worker re-reads the cycle.
        dedupeKey: `weekly_roster_cycle:${cycle.id}:employee:${s.employee_id}`,
        context: {
          employeeId: s.employee_id,
          branchId: cycle.branch_id ?? null,
          processId: cycle.process_id ?? null,
        },
        entityType: 'weekly_roster_cycle',
        entityId: cycle.id,
        correlationId: `roster:${cycle.id}`,
        data: {
          employee_name: s.full_name,
          employee_code: s.employee_code,
          week: weekLabel,
          week_start: cycle.week_start_date,
          week_end: cycle.week_end_date,
          // ── analytics strip (NOTIFICATION_CATALOGUE.md section 6.1) ──
          shifts: Number(s.shifts ?? 0),
          week_offs: Number(s.week_offs ?? 0),
          // Omitted entirely rather than reported as 0 when any assignment's shift
          // template could not be resolved — a wrong zero is worse than no figure.
          nights: Number(s.unresolved_shifts ?? 0) > 0 ? null : Number(s.nights ?? 0),
          holidays: Number(s.holidays ?? 0),
          ack_deadline: cycle.ack_deadline ?? null,
        },
      });
      if (outcome.outcome === 'sent') result.sent++;
      else if (outcome.outcome === 'shadow') result.shadow++;
      else result.skipped++;
    } catch (err) {
      // One employee's failure must not stop the rest of the roster being notified.
      result.skipped++;
      console.error(`[roster-notify] cycle ${cycle.id} employee ${s.employee_id}:`, (err as Error).message);
    }
  }

  return result;
}

/**
 * Post-publication shift change. `roster_change_log` already requires a reason
 * (roster.governance.service.ts:423), which is carried into the body so the employee is
 * told why, not just what.
 */
export async function notifyShiftChanged(args: {
  cycle: RosterCycleContext;
  employeeId: string;
  rosterDate: string;
  changeId: string;
  fromShift?: string | null;
  toShift?: string | null;
  reason?: string | null;
}): Promise<void> {
  try {
    await notificationGateway.notify({
      eventCode: 'shift_changed',
      // Keyed on the change row, so each distinct change notifies exactly once.
      dedupeKey: `roster_change_log:${args.changeId}`,
      context: {
        employeeId: args.employeeId,
        branchId: args.cycle.branch_id ?? null,
        processId: args.cycle.process_id ?? null,
      },
      entityType: 'roster_change_log',
      entityId: args.changeId,
      correlationId: `roster:${args.cycle.id}`,
      data: {
        roster_date: args.rosterDate,
        from_shift: args.fromShift ?? null,
        to_shift: args.toShift ?? null,
        reason: args.reason ?? null,
        // Hours of notice the employee actually got — the figure that makes this email
        // worth reading, and the one a manager should be held to.
        notice_hours: Math.max(
          0,
          Math.round((new Date(args.rosterDate).getTime() - Date.now()) / 3_600_000),
        ),
      },
    });
  } catch (err) {
    console.error(`[roster-notify] shift change ${args.changeId}:`, (err as Error).message);
  }
}
