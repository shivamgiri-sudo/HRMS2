import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";
import { loadWeekoffRules, applyWeekoffRules, sortBySeniorPriority } from "./weekoff-rule.service.js";
import type { WeekoffRule } from "./weekoff-rule.service.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RosterCycleRow extends RowDataPacket {
  id: string;
  process_id: string;
  branch_id: string | null;
  week_start_date: string;
  week_end_date: string;
  status: string;
}

interface EmployeeRow extends RowDataPacket {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  process_id: string;
  branch_id: string | null;
  shift_rotation_type: "frozen" | "weekly" | "daily" | "rotating";
  designation: string | null;
}

interface ShiftTemplateRow extends RowDataPacket {
  id: string;
  shift_code: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  productive_minutes: number;
  process_id: string | null;
}

interface ApprovedWeekOff extends RowDataPacket {
  id: string;
  employee_id: string;
  preferred_day: number;
  alternate_day: number | null;
  approved: number;
  auto_approved: number;
}

interface RosterTemplateRow extends RowDataPacket {
  id: string;
  process_id: string;
  pattern_type: string;
  cycle_days: number;
  pattern_json: string;
  is_active: number;
}

interface HolidayRow extends RowDataPacket {
  holiday_date: string;
}

export interface GenerationResult {
  run_id: string;
  cycle_id: string;
  process_id: string;
  employees_processed: number;
  assignments_created: number;
  weekoffs_allocated: number;
  conflicts_found: number;
  errors: string[];
}

// ── Service ───────────────────────────────────────────────────────────────────

export const rosterGenerationService = {
  async generateForCycle(
    cycleId: string,
    triggeredBy: string,
    req?: Request
  ): Promise<GenerationResult> {
    // 1. Load cycle
    const [cycleRows] = await db.execute<RosterCycleRow[]>(
      "SELECT * FROM weekly_roster_cycle WHERE id = ? LIMIT 1",
      [cycleId]
    );
    const cycle = cycleRows[0];
    if (!cycle) throw Object.assign(new Error("Cycle not found"), { statusCode: 404 });
    if (!["draft", "submitted"].includes(cycle.status)) {
      throw Object.assign(new Error("Auto-generation only allowed on draft or submitted cycles"), { statusCode: 409 });
    }

    const runId = randomUUID();
    const params_json = JSON.stringify({ cycle_id: cycleId, process_id: cycle.process_id, week_start: cycle.week_start_date, week_end: cycle.week_end_date });

    // 2. Create the generation run record (status=running)
    await db.execute(
      `INSERT INTO roster_generation_run
         (id, cycle_id, process_id, branch_id, run_type, parameters_json, status, triggered_by)
       VALUES (?, ?, ?, ?, 'manual_trigger', ?, 'running', ?)`,
      [runId, cycleId, cycle.process_id, cycle.branch_id ?? null, params_json, triggeredBy]
    );

    const result: GenerationResult = {
      run_id: runId,
      cycle_id: cycleId,
      process_id: cycle.process_id,
      employees_processed: 0,
      assignments_created: 0,
      weekoffs_allocated: 0,
      conflicts_found: 0,
      errors: [],
    };

    try {
      // 3. Load active employees for this process/branch
      const empQuery = cycle.branch_id
        ? `SELECT id, employee_code, first_name, last_name, process_id, branch_id,
                  COALESCE(shift_rotation_type, 'frozen') AS shift_rotation_type, designation
             FROM employees WHERE process_id = ? AND branch_id = ? AND active_status = 1`
        : `SELECT id, employee_code, first_name, last_name, process_id, branch_id,
                  COALESCE(shift_rotation_type, 'frozen') AS shift_rotation_type, designation
             FROM employees WHERE process_id = ? AND active_status = 1`;
      const empParams = cycle.branch_id ? [cycle.process_id, cycle.branch_id] : [cycle.process_id];
      const [employees] = await db.execute<EmployeeRow[]>(empQuery, empParams);

      // 4. Load approved week-off preferences for these employees
      const empIds = employees.map((e) => e.id);
      const approvedWeekoffs = empIds.length
        ? await loadApprovedWeekoffs(empIds)
        : new Map<string, ApprovedWeekOff>();

      // 5. Load active shift templates for this process
      const [shiftTemplates] = await db.execute<ShiftTemplateRow[]>(
        `SELECT id, shift_code, shift_name, start_time, end_time, productive_minutes, process_id
           FROM wfm_shift_template
          WHERE (process_id = ? OR process_id IS NULL)
            AND active_status = 1
            AND effective_from <= ?
            AND (effective_to IS NULL OR effective_to >= ?)
          ORDER BY process_id DESC`,
        [cycle.process_id, cycle.week_end_date, cycle.week_start_date]
      );
      const defaultShift = shiftTemplates[0] ?? null;

      // 6. Load public holidays in the week range
      const holidays = await loadHolidays(cycle.week_start_date, cycle.week_end_date);

      // 7. Load roster template for this process (if any)
      const [templateRows] = await db.execute<RosterTemplateRow[]>(
        "SELECT * FROM roster_template WHERE process_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
        [cycle.process_id]
      );
      const rosterTemplate = templateRows[0] ?? null;

      // 7b. Load process week-off rules (blackout, min_gap, force_sunday, senior_priority)
      const weekoffRules = await loadWeekoffRules(cycle.process_id).catch(() => [] as WeekoffRule[]);
      const sortedEmployees = sortBySeniorPriority(weekoffRules, employees as any[]) as EmployeeRow[];

      // 8. Generate dates in the week
      const dates = getDatesInRange(cycle.week_start_date, cycle.week_end_date);

      // 9. Process each employee (sorted by seniority if senior_priority rule applies)
      for (const emp of sortedEmployees) {
        result.employees_processed++;
        try {
          await processEmployee({
            emp,
            dates,
            holidays,
            approvedWeekoffs,
            shiftTemplates,
            defaultShift,
            rosterTemplate,
            weekoffRules,
            cycleId,
            runId,
            result,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`emp:${emp.employee_code} — ${msg}`);
          result.conflicts_found++;
          // Record in decision audit as error
          await db.execute(
            `INSERT INTO roster_decision_audit
               (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied, is_week_off)
             VALUES (UUID(), ?, ?, ?, ?, 'shift_assigned', ?, 0)`,
            [runId, cycleId, emp.id, dates[0] ?? cycle.week_start_date, `error:${msg.slice(0, 80)}`]
          );
        }
      }

      // 10. Update run record to completed
      await db.execute(
        `UPDATE roster_generation_run SET
           status = 'completed',
           employees_processed = ?,
           assignments_created = ?,
           weekoffs_allocated = ?,
           conflicts_found = ?,
           error_details = ?,
           completed_at = NOW()
         WHERE id = ?`,
        [result.employees_processed, result.assignments_created, result.weekoffs_allocated, result.conflicts_found, result.errors.length ? JSON.stringify(result.errors) : null, runId]
      );

      // 11. Update wfm_roster_assignment (live ops table) from generated roster_daily_assignment
      await syncGeneratedToLiveAssignments(cycleId, runId, cycle);

    } catch (fatalErr) {
      const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
      await db.execute(
        "UPDATE roster_generation_run SET status = 'failed', error_details = ?, completed_at = NOW() WHERE id = ?",
        [JSON.stringify([msg]), runId]
      );
      throw fatalErr;
    }

    await logSensitiveAction({
      actor_user_id: triggeredBy,
      action_type: "ROSTER_AUTO_GENERATED",
      module_key: "roster_gov",
      entity_type: "weekly_roster_cycle",
      entity_id: cycleId,
      change_summary: {
        run_id: runId,
        process_id: cycle.process_id,
        employees_processed: result.employees_processed,
        assignments_created: result.assignments_created,
      },
      req,
    });

    return result;
  },

  async listGenerationRuns(cycleId: string): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM roster_generation_run WHERE cycle_id = ? ORDER BY started_at DESC",
      [cycleId]
    );
    return rows;
  },

  async getDecisionAudit(
    runId: string,
    page = 1,
    limit = 100
  ): Promise<{ rows: RowDataPacket[]; total: number }> {
    const offset = (page - 1) * limit;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT rda.*, e.employee_code, e.first_name, e.last_name,
              st.shift_name, st.start_time, st.end_time
         FROM roster_decision_audit rda
         JOIN employees e ON e.id = rda.employee_id
         LEFT JOIN wfm_shift_template st ON st.id = rda.assigned_shift_template_id
        WHERE rda.run_id = ?
        ORDER BY rda.roster_date ASC, e.employee_code ASC
        LIMIT ? OFFSET ?`,
      [runId, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM roster_decision_audit WHERE run_id = ?",
      [runId]
    );
    return { rows, total: (countRows[0] as any).total ?? 0 };
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadApprovedWeekoffs(empIds: string[]): Promise<Map<string, ApprovedWeekOff>> {
  const placeholders = empIds.map(() => "?").join(",");
  const [rows] = await db.execute<ApprovedWeekOff[]>(
    `SELECT * FROM week_off_preference WHERE employee_id IN (${placeholders}) AND approved = 1`,
    empIds
  );
  const map = new Map<string, ApprovedWeekOff>();
  for (const row of rows) map.set(row.employee_id, row);
  return map;
}

async function loadHolidays(from: string, to: string): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const [rows] = await db.execute<HolidayRow[]>(
      "SELECT holiday_date FROM company_events WHERE event_type = 'holiday' AND holiday_date BETWEEN ? AND ?",
      [from, to]
    );
    for (const r of rows) set.add(r.holiday_date.slice(0, 10));
  } catch {
    // company_events may not exist in all environments; treat as no holidays
  }
  return set;
}

function getDatesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function processEmployee(ctx: {
  emp: EmployeeRow;
  dates: string[];
  holidays: Set<string>;
  approvedWeekoffs: Map<string, ApprovedWeekOff>;
  shiftTemplates: ShiftTemplateRow[];
  defaultShift: ShiftTemplateRow | null;
  rosterTemplate: RosterTemplateRow | null;
  weekoffRules: WeekoffRule[];
  cycleId: string;
  runId: string;
  result: GenerationResult;
}): Promise<void> {
  const { emp, dates, holidays, approvedWeekoffs, defaultShift, weekoffRules, cycleId, runId, result } = ctx;
  const weekoff = approvedWeekoffs.get(emp.id);
  let lastWeekoffDate: string | null = null;

  for (const date of dates) {
    const isHoliday = ctx.holidays.has(date);
    const dateObj = new Date(date + "T00:00:00");
    const dayOfWeek = dateObj.getDay(); // 0=Sun
    let isWeekOffDay = weekoff ? weekoff.preferred_day === dayOfWeek : false;

    let decisionType: string;
    let shiftTemplateId: string | null = null;
    let ruleApplied: string;

    if (isHoliday) {
      decisionType = "holiday_applied";
      ruleApplied = "holiday_override";
    } else if (isWeekOffDay && weekoff) {
      // Apply process week-off rules before granting the week-off
      const ruling = applyWeekoffRules(weekoffRules, {
        employeeId: emp.id,
        designation: emp.designation,
        preferredDay: weekoff.preferred_day,
        candidateDate: date,
        dow: dayOfWeek,
        lastWeekoffDate,
      });
      if (!ruling.allow) {
        isWeekOffDay = false;
        ruleApplied = ruling.reason;
        decisionType = "weekoff_denied";
        shiftTemplateId = defaultShift?.id ?? null;
      } else if (ruling.override) {
        // force_sunday override: only grant if this date IS Sunday
        if (dayOfWeek === ruling.override.day) {
          decisionType = "weekoff_assigned";
          ruleApplied = ruling.reason;
          result.weekoffs_allocated++;
          lastWeekoffDate = date;
        } else {
          isWeekOffDay = false;
          decisionType = "weekoff_redirected";
          ruleApplied = ruling.reason;
          shiftTemplateId = defaultShift?.id ?? null;
        }
      } else {
        decisionType = "weekoff_assigned";
        ruleApplied = "fcfs";
        result.weekoffs_allocated++;
        lastWeekoffDate = date;
      }
    } else if (emp.shift_rotation_type === "frozen") {
      decisionType = "shift_frozen";
      shiftTemplateId = defaultShift?.id ?? null;
      ruleApplied = "frozen_rotation";
    } else {
      // For weekly/daily/rotating — use defaultShift (template-based rotation can be enhanced later)
      decisionType = "shift_assigned";
      shiftTemplateId = defaultShift?.id ?? null;
      ruleApplied = emp.shift_rotation_type === "weekly" ? "weekly_rotation" : emp.shift_rotation_type === "daily" ? "daily_rotation" : "rotating_cycle";
    }

    if (shiftTemplateId === null && !isHoliday && !isWeekOffDay) {
      result.errors.push(`emp:${emp.employee_code} date:${date} — no shift template available`);
      result.conflicts_found++;
      continue;
    }

    // Upsert roster_daily_assignment
    await db.execute(
      `INSERT INTO roster_daily_assignment
         (id, cycle_id, employee_id, roster_date, shift_template_id, is_week_off, is_holiday)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         shift_template_id = VALUES(shift_template_id),
         is_week_off       = VALUES(is_week_off),
         is_holiday        = VALUES(is_holiday)`,
      [cycleId, emp.id, date, shiftTemplateId, isWeekOffDay ? 1 : 0, isHoliday ? 1 : 0]
    );

    // Audit record
    await db.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, employee_id, roster_date, decision_type,
          assigned_shift_template_id, is_week_off, preferred_day, allocated_day, rule_applied)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId, cycleId, emp.id, date, decisionType,
        shiftTemplateId,
        isWeekOffDay ? 1 : 0,
        weekoff?.preferred_day ?? null,
        isWeekOffDay ? dayOfWeek : null,
        ruleApplied,
      ]
    );

    result.assignments_created++;
  }
}

async function syncGeneratedToLiveAssignments(
  cycleId: string,
  runId: string,
  cycle: RosterCycleRow
): Promise<void> {
  // Copy roster_daily_assignment rows into wfm_roster_assignment (the live ops table)
  // Only non-weekoff, non-holiday rows get a live assignment; week-off days are excluded
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rda.employee_id, rda.roster_date, rda.shift_template_id,
            st.id AS shift_master_id
       FROM roster_daily_assignment rda
       LEFT JOIN wfm_shift_template wst ON wst.id = rda.shift_template_id
       LEFT JOIN wfm_shift_master st ON st.shift_code = wst.shift_code AND st.active_status = 1
      WHERE rda.cycle_id = ? AND rda.is_week_off = 0 AND rda.is_holiday = 0`,
    [cycleId]
  );

  for (const row of rows) {
    await db.execute(
      `INSERT INTO wfm_roster_assignment
         (id, employee_id, shift_id, roster_date, roster_status, publish_status,
          generation_run_id, decision_source)
       VALUES (UUID(), ?, ?, ?, 'Rostered', 'draft', ?, 'rule_engine')
       ON DUPLICATE KEY UPDATE
         shift_id          = VALUES(shift_id),
         generation_run_id = VALUES(generation_run_id),
         decision_source   = 'rule_engine'`,
      [row.employee_id, row.shift_master_id ?? null, row.roster_date, runId]
    );
  }
}
