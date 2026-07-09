import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { rosterCapacityService } from "./roster-capacity.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

export interface FcfsAllocationResult {
  process_id: string;
  cycle_id: string;
  week_start_date: string;
  processed: number;
  allocated: number;
  waitlisted: number;
  denied: number;
  already_approved: number;
  errors: string[];
}

interface PendingPreference extends RowDataPacket {
  id: string;
  employee_id: string;
  preferred_day: number;
  alternate_day: number | null;
  approved: number;
  auto_approved: number;
  submission_order: number | null;
  process_id: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAME_TO_INT: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

export const weekoffAllocationService = {
  async runFcfsAllocation(
    processId: string,
    cycleId: string,
    userId: string,
    req?: Request
  ): Promise<FcfsAllocationResult> {
    // Load the cycle to get week_start_date for allocation_date anchor
    const [cycleRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, process_id, week_start_date, status FROM weekly_roster_cycle WHERE id = ? LIMIT 1",
      [cycleId]
    );
    const cycle = cycleRows[0];
    if (!cycle) throw Object.assign(new Error("Cycle not found"), { statusCode: 404 });
    if (!["draft", "submitted", "reviewed"].includes(cycle.status)) {
      throw Object.assign(new Error("FCFS allocation can only run on draft/submitted/reviewed cycles"), { statusCode: 409 });
    }

    // Load pending preferences for this process, ordered by submission_order (FCFS)
    // Skip preferences already manually approved by a human (approved=1 AND auto_approved=0)
    const [prefs] = await db.execute<PendingPreference[]>(
      `SELECT wop.*, e.process_id
         FROM week_off_preference wop
         JOIN employees e ON e.id = wop.employee_id
        WHERE e.process_id = ?
          AND e.active_status = 1
          AND (wop.approved = 0 OR (wop.approved = 1 AND wop.auto_approved = 1))
        ORDER BY COALESCE(wop.submission_order, 999999) ASC, wop.created_at ASC`,
      [processId]
    );

    // Also load approved preferences from the governance route table (employee_roster_preference)
    // that correspond to this cycle's week, and merge them in as synthetic PendingPreference rows
    const [govPrefs] = await db.execute<import("mysql2").RowDataPacket[]>(
      `SELECT erp.id, erp.employee_id, erp.preferred_week_off, erp.created_at
         FROM employee_roster_preference erp
         JOIN employees e ON e.id = erp.employee_id
        WHERE e.process_id = ?
          AND e.active_status = 1
          AND erp.status = 'approved'
          AND (erp.week_start_date = ? OR erp.week_start_date IS NULL)`,
      [processId, cycle.week_start_date]
    );

    // Convert governance rows to PendingPreference shape and skip duplicates already in prefs
    const existingEmployeeIds = new Set(prefs.map((p: PendingPreference) => p.employee_id));
    for (const gp of govPrefs) {
      if (existingEmployeeIds.has(gp.employee_id)) continue;
      const dayInt = DAY_NAME_TO_INT[gp.preferred_week_off as string] ?? -1;
      if (dayInt < 0) continue;
      (prefs as PendingPreference[]).push({
        id: gp.id,
        employee_id: gp.employee_id,
        preferred_day: dayInt,
        alternate_day: null,
        approved: 0,
        auto_approved: 0,
        submission_order: null,
        process_id: processId,
        created_at: gp.created_at,
      } as unknown as PendingPreference);
    }

    const result: FcfsAllocationResult = {
      process_id: processId,
      cycle_id: cycleId,
      week_start_date: cycle.week_start_date,
      processed: 0,
      allocated: 0,
      waitlisted: 0,
      denied: 0,
      already_approved: 0,
      errors: [],
    };

    for (const pref of prefs) {
      result.processed++;

      // Calculate the actual date for this day-of-week in the cycle's week
      const allocationDate = getDateForDayOfWeek(cycle.week_start_date, pref.preferred_day);

      try {
        const capacityCheck = await rosterCapacityService.checkCapacity(
          processId,
          allocationDate,
          pref.preferred_day
        );

        if (capacityCheck.can_allocate) {
          // Check auto-approve threshold
          const autoApprove = await rosterCapacityService.shouldAutoApprove(
            processId,
            pref.preferred_day,
            capacityCheck.current_count
          );

          // Record allocation
          await db.execute(
            `INSERT INTO weekoff_allocation_log
               (id, process_id, day_of_week, allocation_date, employee_id, preference_id,
                allocation_sequence, allocation_status, auto_approved)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'allocated', ?)
             ON DUPLICATE KEY UPDATE
               allocation_status = 'allocated',
               allocation_sequence = VALUES(allocation_sequence),
               auto_approved = VALUES(auto_approved)`,
            [
              randomUUID(),
              processId,
              pref.preferred_day,
              allocationDate,
              pref.employee_id,
              pref.id,
              capacityCheck.allocation_sequence,
              autoApprove ? 1 : 0,
            ]
          );

          // Update week_off_preference
          await db.execute(
            "UPDATE week_off_preference SET approved = ?, auto_approved = ? WHERE id = ?",
            [autoApprove ? 1 : 0, autoApprove ? 1 : 0, pref.id]
          );

          // Write in-app notification
          await rosterCapacityService.createNotification({
            employee_id: pref.employee_id,
            preference_id: pref.id,
            notification_type: autoApprove ? "approved" : "waitlisted",
            message: autoApprove
              ? `Your week-off on ${DAY_NAMES[pref.preferred_day]} has been auto-approved for the week of ${cycle.week_start_date}.`
              : `Your week-off on ${DAY_NAMES[pref.preferred_day]} is pending final WFM review (capacity slot reserved).`,
            roster_date: allocationDate,
          });

          result.allocated++;
        } else {
          // Capacity full — try alternate day if set
          let waitlisted = false;
          if (pref.alternate_day !== null && pref.alternate_day !== pref.preferred_day) {
            const altDate = getDateForDayOfWeek(cycle.week_start_date, pref.alternate_day);
            const altCapacity = await rosterCapacityService.checkCapacity(
              processId,
              altDate,
              pref.alternate_day
            );
            if (altCapacity.can_allocate) {
              await db.execute(
                `INSERT INTO weekoff_allocation_log
                   (id, process_id, day_of_week, allocation_date, employee_id, preference_id,
                    allocation_sequence, allocation_status, auto_approved)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'waitlisted', 0)
                 ON DUPLICATE KEY UPDATE allocation_status = 'waitlisted'`,
                [
                  randomUUID(), processId, pref.alternate_day, altDate,
                  pref.employee_id, pref.id, altCapacity.allocation_sequence,
                ]
              );
              await rosterCapacityService.createNotification({
                employee_id: pref.employee_id,
                preference_id: pref.id,
                notification_type: "waitlisted",
                message: `${DAY_NAMES[pref.preferred_day]} is full. Your alternate day (${DAY_NAMES[pref.alternate_day]}) has been waitlisted for week of ${cycle.week_start_date}.`,
                roster_date: altDate,
              });
              waitlisted = true;
              result.waitlisted++;
            }
          }

          if (!waitlisted) {
            await db.execute(
              `INSERT INTO weekoff_allocation_log
                 (id, process_id, day_of_week, allocation_date, employee_id, preference_id,
                  allocation_sequence, allocation_status, auto_approved)
               VALUES (?, ?, ?, ?, ?, ?, 0, 'denied', 0)
               ON DUPLICATE KEY UPDATE allocation_status = 'denied'`,
              [randomUUID(), processId, pref.preferred_day, allocationDate, pref.employee_id, pref.id]
            );
            await rosterCapacityService.createNotification({
              employee_id: pref.employee_id,
              preference_id: pref.id,
              notification_type: "denied",
              message: `Your week-off preference for ${DAY_NAMES[pref.preferred_day]} could not be accommodated for week of ${cycle.week_start_date} — capacity full.`,
              roster_date: allocationDate,
            });
            result.denied++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`emp:${pref.employee_id} day:${pref.preferred_day} — ${msg}`);
      }
    }

    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "WEEKOFF_FCFS_ALLOCATION_RUN",
      module_key: "roster_gov",
      entity_type: "weekly_roster_cycle",
      entity_id: cycleId,
      change_summary: {
        process_id: processId,
        allocated: result.allocated,
        waitlisted: result.waitlisted,
        denied: result.denied,
      },
      req,
    });

    return result;
  },

  async getCapacitySummary(
    processId: string,
    weekStartDate: string
  ): Promise<Array<{ day_of_week: number; day_name: string; allocated: number; max_count: number; max_percentage: number | null; slots_remaining: number }>> {
    const summary: Array<{ day_of_week: number; day_name: string; allocated: number; max_count: number; max_percentage: number | null; slots_remaining: number }> = [];
    for (let day = 0; day <= 6; day++) {
      const config = await rosterCapacityService.getCapacityConfig(processId, day);
      const allocationDate = getDateForDayOfWeek(weekStartDate, day);
      const [allocated] = await db.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM weekoff_allocation_log WHERE process_id = ? AND allocation_date = ? AND allocation_status = 'allocated'",
        [processId, allocationDate]
      );
      const allocCount = (allocated[0] as any).cnt ?? 0;
      const maxCount = config?.max_weekoff_count ?? 0;
      summary.push({
        day_of_week: day,
        day_name: DAY_NAMES[day],
        allocated: allocCount,
        max_count: maxCount,
        max_percentage: config?.max_weekoff_percentage ?? null,
        slots_remaining: Math.max(0, maxCount - allocCount),
      });
    }
    return summary;
  },
};

function getDateForDayOfWeek(weekStartDate: string, dayOfWeek: number): string {
  // weekStartDate is always Monday (day 1); Sunday = day 0 = 6 days after Monday
  const [y, m, d] = weekStartDate.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  // base is Monday (getDay()==1). Compute offset so that Sun=0 is 6 days after, Mon=1 is 0, etc.
  const baseDay = base.getDay(); // should be 1 (Monday) for standard cycles
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - baseDay;
  base.setDate(base.getDate() + offset);
  return base.toISOString().slice(0, 10);
}
