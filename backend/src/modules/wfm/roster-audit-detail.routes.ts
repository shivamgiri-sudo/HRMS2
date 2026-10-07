/**
 * Drill-down detail endpoints for the Roster Audit Trail panel (Drill-Down Mandate):
 *   GET /trails/:id            full audit record + timeline + employee trend + related + amendments
 *   GET /generation-runs/:id   full run record + timeline + decision breakdown + decisions + sibling runs
 * Registered onto the roster-audit router (kept separate to stay under the file-size limit).
 */
import type { Response, Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import {
  effectiveDecisionCode,
  formatDecisionType,
  ENGINE_ERROR_CODE,
  addDaysIso,
} from "./roster-audit.helpers.js";
import { actorName, resolveActors } from "./roster-audit.actors.js";

function parseJson(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

interface TimelineEntry {
  at: string | null;
  event: string;
  actor: string;
  decision: string | null;
  remarks: string | null;
}

const byTime = (a: TimelineEntry, b: TimelineEntry) =>
  String(a.at ?? "").localeCompare(String(b.at ?? ""));

export function mountAuditDetailRoutes(
  router: Router,
  wrap: (fn: Function) => (req: any, res: any, next: any) => void,
  roles: readonly string[],
): void {
  router.get(
    "/trails/:id",
    requireRole(...roles),
    wrap(async (req: AuthenticatedRequest, res: Response) => {
      const { id } = req.params;

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT
           rda.*,
           e.employee_code AS employeeCode,
           e.full_name AS employeeName,
           p.process_name AS processName,
           b.branch_name AS branchName,
           st.shift_name AS shiftName, st.shift_code AS shiftCode,
           st.start_time AS shiftStart, st.end_time AS shiftEnd,
           wc.week_start_date AS cycleWeekStart, wc.week_end_date AS cycleWeekEnd, wc.status AS cycleStatus,
           rgr.run_type AS runType, rgr.status AS runStatus,
           rgr.started_at AS runStartedAt, rgr.completed_at AS runCompletedAt,
           rgr.triggered_by AS triggeredById
         FROM roster_decision_audit rda
         LEFT JOIN employees e ON rda.employee_id = e.id
         LEFT JOIN process_master p ON p.id = COALESCE(rda.process_id, e.process_id)
         LEFT JOIN branch_master b ON b.id = COALESCE(rda.branch_id, e.branch_id)
         LEFT JOIN wfm_shift_template st ON rda.assigned_shift_template_id = st.id
         LEFT JOIN weekly_roster_cycle wc ON rda.cycle_id = wc.id
         LEFT JOIN roster_generation_run rgr ON rda.run_id = rgr.id
         WHERE rda.id = ?
         LIMIT 1`,
        [id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Audit trail entry not found" });
        return;
      }
      const r = rows[0];
      const rosterDate = String(r.roster_date).slice(0, 10);
      const code = effectiveDecisionCode(r.decision_type, r.rule_applied);

      const [[relatedRows], [trendRows], [amendRows]] = await Promise.all([
        db.execute<RowDataPacket[]>(
          `SELECT id, roster_date AS date, decision_type AS changeType, rule_applied AS reason,
                  override_reason AS overrideReason, override_by AS changedById, created_at AS timestamp
             FROM roster_decision_audit
            WHERE employee_id = ? AND id != ?
              AND roster_date BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND DATE_ADD(?, INTERVAL 7 DAY)
            ORDER BY created_at DESC
            LIMIT 10`,
          [r.employee_id, id, rosterDate, rosterDate],
        ),
        db.execute<RowDataPacket[]>(
          `SELECT roster_date AS d, COUNT(*) AS total, SUM(override_by IS NOT NULL) AS overrides
             FROM roster_decision_audit
            WHERE employee_id = ? AND roster_date BETWEEN ? AND ?
              AND (rule_applied IS NULL OR rule_applied NOT LIKE 'error:%')
            GROUP BY roster_date ORDER BY roster_date`,
          [r.employee_id, addDaysIso(rosterDate, -30), rosterDate],
        ),
        db.execute<RowDataPacket[]>(
          `SELECT id, change_type AS changeType, reason, change_date AS changeDate, changed_by AS changedById,
                  created_at AS timestamp, new_assignment_type AS newAssignmentType,
                  old_shift_id AS oldShiftId, new_shift_id AS newShiftId,
                  is_late_change AS isLateChange, lead_time_hours AS leadTimeHours
             FROM roster_change_log
            WHERE cycle_id = ? AND employee_id = ?
            ORDER BY created_at DESC
            LIMIT 10`,
          [r.cycle_id, r.employee_id],
        ),
      ]);

      const actors = await resolveActors([
        r.override_by,
        r.triggeredById,
        ...relatedRows.map((x) => x.changedById),
        ...amendRows.map((x) => x.changedById),
      ]);
      const changedBy = r.override_by
        ? actorName(actors, r.override_by)
        : r.triggeredById
          ? actorName(actors, r.triggeredById)
          : "System";

      const timeline: TimelineEntry[] = [];
      if (r.run_id) {
        timeline.push({
          at: r.runStartedAt ?? null,
          event: "Generation run started",
          actor: actorName(actors, r.triggeredById),
          decision: r.runType ?? null,
          remarks: null,
        });
      }
      timeline.push({
        at: r.created_at,
        event: "Decision recorded",
        actor: r.override_by ? actorName(actors, r.override_by) : "System",
        decision: formatDecisionType(code),
        remarks: r.rule_applied ?? null,
      });
      if (r.override_by) {
        timeline.push({
          at: r.override_at ?? r.created_at,
          event: "Manual override",
          actor: actorName(actors, r.override_by),
          decision: formatDecisionType(code),
          remarks: r.override_reason ?? null,
        });
      }
      if (r.runCompletedAt) {
        timeline.push({
          at: r.runCompletedAt,
          event: `Generation run ${r.runStatus ?? "finished"}`,
          actor: "System",
          decision: r.runStatus ?? null,
          remarks: null,
        });
      }
      timeline.sort(byTime);

      res.json({
        id: r.id,
        date: r.roster_date,
        changeType: formatDecisionType(code),
        changeTypeCode: code,
        isEngineError: code === ENGINE_ERROR_CODE,
        reason: r.override_reason || r.rule_applied || "System generated",
        ruleApplied: r.rule_applied,
        overrideReason: r.override_reason,
        overrideAt: r.override_at,
        timestamp: r.created_at,
        cycleId: r.cycle_id,
        cycle: r.cycle_id
          ? {
              id: r.cycle_id,
              weekStart: r.cycleWeekStart ?? r.week_start_date ?? null,
              weekEnd: r.cycleWeekEnd ?? null,
              status: r.cycleStatus ?? null,
            }
          : null,
        employee: {
          id: r.employee_id,
          code: r.employeeCode,
          name: r.employeeName,
        },
        processName: r.processName,
        branchName: r.branchName,
        shift: r.shiftName
          ? {
              name: r.shiftName,
              code: r.shiftCode,
              startTime: r.shiftStart,
              endTime: r.shiftEnd,
            }
          : null,
        engine: {
          isWeekOff: Number(r.is_week_off) === 1,
          preferredDay: r.preferred_day ?? null,
          allocatedDay: r.allocated_day ?? null,
          allocationSequence: r.allocation_sequence ?? null,
          fcfsRank: r.fcfs_rank ?? null,
          fairnessScore:
            r.fairness_score === null || r.fairness_score === undefined
              ? null
              : Number(r.fairness_score),
          skillCheckResult: r.skill_check_result ?? null,
          capacityAtAllocation: parseJson(r.capacity_at_allocation),
        },
        oldValue: parseJson(r.old_value_json),
        newValue: parseJson(r.new_value_json),
        changedBy,
        changedById: r.override_by || r.triggeredById || null,
        changedByCode: r.override_by
          ? (actors.get(r.override_by)?.code ?? null)
          : null,
        actedByRole: r.acted_by_role ?? null,
        run: r.run_id
          ? {
              id: r.run_id,
              runType: r.runType,
              status: r.runStatus,
              startedAt: r.runStartedAt,
              completedAt: r.runCompletedAt,
              triggeredBy: actorName(actors, r.triggeredById),
            }
          : null,
        timeline,
        employeeTrend: trendRows.map((t) => ({
          date: t.d,
          total: Number(t.total),
          overrides: Number(t.overrides ?? 0),
        })),
        relatedChanges: relatedRows.map((rr: RowDataPacket) => ({
          id: rr.id,
          date: rr.date,
          changeType: formatDecisionType(
            effectiveDecisionCode(rr.changeType, rr.reason),
          ),
          reason: rr.overrideReason || rr.reason || "System generated",
          timestamp: rr.timestamp,
          changedBy: rr.changedById
            ? actorName(actors, rr.changedById)
            : "System",
        })),
        amendments: amendRows.map((a: RowDataPacket) => ({
          id: a.id,
          changeType: a.changeType,
          reason: a.reason,
          changeDate: a.changeDate,
          timestamp: a.timestamp,
          newAssignmentType: a.newAssignmentType,
          isLateChange: Number(a.isLateChange) === 1,
          leadTimeHours:
            a.leadTimeHours === null ? null : Number(a.leadTimeHours),
          changedBy: actorName(actors, a.changedById),
        })),
      });
    }),
  );

  router.get(
    "/generation-runs/:id",
    requireRole(...roles),
    wrap(async (req: AuthenticatedRequest, res: Response) => {
      const { id } = req.params;

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT
           rgr.*,
           TIMESTAMPDIFF(SECOND, rgr.started_at, rgr.completed_at) AS durationSeconds,
           p.process_name AS processName,
           b.branch_name AS branchName,
           wc.week_start_date AS weekStart, wc.week_end_date AS weekEnd, wc.status AS cycleStatus
         FROM roster_generation_run rgr
         LEFT JOIN process_master p ON rgr.process_id = p.id
         LEFT JOIN branch_master b ON rgr.branch_id = b.id
         LEFT JOIN weekly_roster_cycle wc ON rgr.cycle_id = wc.id
         WHERE rgr.id = ?
         LIMIT 1`,
        [id],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "Generation run not found" });
        return;
      }
      const r = rows[0];

      const [[decisionRows], [breakdownRows], [dailyRows], [siblingRows]] =
        await Promise.all([
          db.execute<RowDataPacket[]>(
            `SELECT rda.id, rda.roster_date AS date, rda.decision_type AS changeType,
                  rda.override_reason AS overrideReason, rda.rule_applied AS reason,
                  rda.created_at AS timestamp, e.employee_code AS employeeCode, e.full_name AS employeeName
             FROM roster_decision_audit rda
             LEFT JOIN employees e ON rda.employee_id = e.id
            WHERE rda.run_id = ?
            ORDER BY rda.created_at DESC, rda.id DESC
            LIMIT 100`,
            [id],
          ),
          db.execute<RowDataPacket[]>(
            `SELECT decision_type, COALESCE(rule_applied LIKE 'error:%', 0) AS is_error, COUNT(*) AS count
             FROM roster_decision_audit WHERE run_id = ?
            GROUP BY decision_type, is_error`,
            [id],
          ),
          db.execute<RowDataPacket[]>(
            `SELECT roster_date AS d, COUNT(*) AS total
             FROM roster_decision_audit WHERE run_id = ?
            GROUP BY roster_date ORDER BY roster_date`,
            [id],
          ),
          db.execute<RowDataPacket[]>(
            `SELECT id, run_type AS runType, status, started_at AS startedAt, completed_at AS completedAt,
                  assignments_created AS assignmentsCreated, conflicts_found AS conflictsFound
             FROM roster_generation_run
            WHERE cycle_id = ? AND id != ?
            ORDER BY started_at DESC
            LIMIT 5`,
            [r.cycle_id, id],
          ),
        ]);

      const actors = await resolveActors([r.triggered_by]);
      const trigger = actors.get(r.triggered_by);
      const triggerName = actorName(actors, r.triggered_by);

      let decisionTotal = 0;
      let errorTotal = 0;
      const decisionSummary = breakdownRows
        .map((b: RowDataPacket) => {
          const count = Number(b.count);
          decisionTotal += count;
          const isError = Number(b.is_error) === 1;
          if (isError) errorTotal += count;
          const c = isError ? ENGINE_ERROR_CODE : b.decision_type;
          return { code: c, label: formatDecisionType(c), count };
        })
        .sort((a, b) => b.count - a.count);

      const timeline: TimelineEntry[] = [
        {
          at: r.started_at,
          event: "Run started",
          actor: triggerName,
          decision: r.run_type,
          remarks: null,
        },
      ];
      if (r.completed_at) {
        timeline.push({
          at: r.completed_at,
          event: `Run ${r.status}`,
          actor: "System",
          decision: r.status,
          remarks: null,
        });
      }

      res.json({
        id: r.id,
        cycleId: r.cycle_id,
        cycle: {
          id: r.cycle_id,
          weekStart: r.weekStart ?? null,
          weekEnd: r.weekEnd ?? null,
          status: r.cycleStatus ?? null,
        },
        processId: r.process_id,
        processName: r.processName,
        branchId: r.branch_id,
        branchName: r.branchName,
        runType: r.run_type,
        status: r.status,
        stats: {
          employeesProcessed: Number(r.employees_processed ?? 0),
          assignmentsCreated: Number(r.assignments_created ?? 0),
          weekoffsAllocated: Number(r.weekoffs_allocated ?? 0),
          conflictsFound: Number(r.conflicts_found ?? 0),
        },
        startedAt: r.started_at,
        completedAt: r.completed_at,
        duration:
          r.durationSeconds === null || r.durationSeconds === undefined
            ? null
            : Math.max(0, Number(r.durationSeconds)),
        triggeredBy: {
          id: r.triggered_by,
          name: triggerName,
          code: trigger?.code ?? null,
        },
        parameters: parseJson(r.parameters_json),
        errorDetails: parseJson(r.error_details),
        timeline,
        decisionSummary,
        decisionTotal,
        engineErrorCount: errorTotal,
        decisionsByDate: dailyRows.map((d) => ({
          date: d.d,
          total: Number(d.total),
        })),
        decisions: decisionRows.map((d: RowDataPacket) => {
          const c = effectiveDecisionCode(d.changeType, d.reason);
          return {
            id: d.id,
            date: d.date,
            changeType: formatDecisionType(c),
            changeTypeCode: c,
            reason: d.overrideReason || d.reason || "System generated",
            timestamp: d.timestamp,
            employee: { code: d.employeeCode, name: d.employeeName },
          };
        }),
        siblingRuns: siblingRows.map((s: RowDataPacket) => ({
          id: s.id,
          runType: s.runType,
          status: s.status,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          assignmentsCreated: Number(s.assignmentsCreated ?? 0),
          conflictsFound: Number(s.conflictsFound ?? 0),
        })),
      });
    }),
  );
}
