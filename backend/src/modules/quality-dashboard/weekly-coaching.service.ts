import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";
import type { RowDataPacket } from "mysql2";
import { raiseCoachingFromQuality } from "./coaching-writer.service.js";

/**
 * Weekly quality review: who fell short last week, and should anyone talk to them.
 *
 * Deliberately evaluated on a rolling ISO week (Mon–Sun) every night rather than
 * on a fixed weekday. A "runs on Monday" job silently skips an entire week if
 * that one night fails, and this codebase has a strong recent history of jobs
 * failing unnoticed — dialer_1 managed 864 consecutive failures over 36 days.
 * Running nightly with idempotency in the writer gives exactly one session per
 * agent per week and heals itself if a night is missed.
 *
 * Everything it needs is already stored: kpi_daily_actual carries the daily
 * quality facts, and kpi_employee_resolved carries each employee's resolved
 * target. Nothing is recomputed from the upstream source here.
 */

/** Monday 00:00 of the ISO week containing `date`, and its Sunday. */
export function isoWeekBounds(date: string): { start: string; end: string } {
  const d = new Date(`${date}T00:00:00.000Z`);
  // getUTCDay: 0 = Sunday. Shift so Monday is day 0.
  const offset = (d.getUTCDay() + 6) % 7;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - offset);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

type WeeklyQualityRow = {
  employee_id: string;
  metric_id: string;
  process_id: string | null;
  process_name: string | null;
  avg_value: number | null;
  target_value: number | null;
  sample_days: number;
  audit_count: number | null;
  fatal_weeks: number;
};

/**
 * Quality for one week per employee, with the target already resolved.
 *
 * Averaged across the days present rather than the days in the week: an agent
 * who worked two days is judged on those two, not marked down for five absences.
 */
async function weeklyQuality(start: string, end: string): Promise<WeeklyQualityRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT k.employee_id,
            k.metric_id,
            e.process_id,
            p.process_name,
            ROUND(AVG(k.actual_value), 2)          AS avg_value,
            MAX(r.target_value)                    AS target_value,
            COUNT(*)                               AS sample_days,
            SUM(COALESCE(k.source_record_count, 0)) AS audit_count,
            0                                      AS fatal_weeks
       FROM kpi_daily_actual k
       JOIN kpi_metric_master m ON m.id = k.metric_id
       LEFT JOIN employees e ON e.id = k.employee_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN kpi_employee_resolved r
              ON r.employee_id = k.employee_id AND r.metric_id = k.metric_id
      WHERE m.metric_code = 'QUALITY_SCORE'
        AND k.score_date BETWEEN ? AND ?
      GROUP BY k.employee_id, k.metric_id, e.process_id, p.process_name`,
    [start, end],
  );
  return rows as unknown as WeeklyQualityRow[];
}

/**
 * How many consecutive prior weeks this employee also fell short.
 *
 * Drives escalation: the difference between a first conversation and a PIP is
 * whether coaching has already been tried and failed to move the number.
 */
async function consecutiveShortfalls(
  employeeId: string,
  metricId: string,
  beforeWeekStart: string,
  lookbackWeeks = 8,
): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT YEARWEEK(k.score_date, 3) AS wk,
            AVG(k.actual_value)       AS avg_value,
            MAX(r.target_value)       AS target_value
       FROM kpi_daily_actual k
       LEFT JOIN kpi_employee_resolved r
              ON r.employee_id = k.employee_id AND r.metric_id = k.metric_id
      WHERE k.employee_id = ? AND k.metric_id = ?
        AND k.score_date < ?
        AND k.score_date >= DATE_SUB(?, INTERVAL ? WEEK)
      GROUP BY wk
      ORDER BY wk DESC`,
    [employeeId, metricId, beforeWeekStart, beforeWeekStart, lookbackWeeks],
  );

  let streak = 0;
  for (const row of rows as any[]) {
    const target = Number(row.target_value ?? 0);
    const value = Number(row.avg_value ?? 0);
    // No target means the week cannot be called short, so the streak stops
    // rather than counting an unmeasurable week as a failure.
    if (!target || value >= target * 0.9) break;
    streak += 1;
  }
  return streak;
}

export type WeeklyCoachingResult = {
  weekStart: string;
  weekEnd: string;
  evaluated: number;
  raised: number;
  skippedNoTrigger: number;
  skippedAlreadyOpen: number;
  skippedNoCoach: number;
  /**
   * Had quality, but no target to judge it against.
   *
   * Counted separately because it is not the same as meeting the bar — there
   * is no bar. Folding the two together hides the fact that coaching cannot
   * fire at all: on 2026-08-02 all 41 agents with quality that week had no
   * resolved target, and zero QUALITY_SCORE targets were configured anywhere.
   */
  skippedMissingTarget: number;
  /**
   * Which processes are missing a target, and how many people that costs.
   *
   * A bare count says coaching is inert; this says where to go and fix it. The
   * dashboard and the log line both read from here.
   */
  processesMissingTarget: Array<{ processId: string; processName: string; employeeCount: number }>;
};

export async function runWeeklyCoachingEvaluation(referenceDate: string): Promise<WeeklyCoachingResult> {
  const { start, end } = isoWeekBounds(referenceDate);
  const rows = await weeklyQuality(start, end);

  const result: WeeklyCoachingResult = {
    weekStart: start, weekEnd: end, evaluated: rows.length,
    raised: 0, skippedNoTrigger: 0, skippedAlreadyOpen: 0, skippedNoCoach: 0, skippedMissingTarget: 0,
    processesMissingTarget: [],
  };

  for (const row of rows) {
    try {
      // Distinguished before the trigger is even asked, because the trigger
      // cannot tell the caller WHY it declined and "no target" is the one
      // reason that means nobody can be coached at all.
      if (row.target_value === null || Number(row.target_value) <= 0) {
        result.skippedMissingTarget += 1;
        const pid = row.process_id ? String(row.process_id) : "unassigned";
        const existing = result.processesMissingTarget.find((x) => x.processId === pid);
        if (existing) existing.employeeCount += 1;
        else result.processesMissingTarget.push({
          processId: pid,
          processName: row.process_name ? String(row.process_name) : "(no process assigned)",
          employeeCount: 1,
        });
        continue;
      }
      const outcome = await raiseCoachingFromQuality({
        employeeId: String(row.employee_id),
        periodStart: start,
        periodEnd: end,
        metricId: String(row.metric_id),
        signal: {
          qualityPercentage: row.avg_value === null ? null : Number(row.avg_value),
          // Weekly averages cannot express a single fatal call; those are raised
          // from the audit itself, where the breach is actually known.
          fatalTriggered: false,
          targetPercentage: row.target_value === null ? null : Number(row.target_value),
          consecutiveShortfalls: await consecutiveShortfalls(
            String(row.employee_id), String(row.metric_id), start,
          ),
          // Audits assessed, not days worked — three days of one audit each is
          // not the same evidence as three days of twenty.
          sampleSize: Number(row.audit_count ?? 0) || Number(row.sample_days ?? 0),
        },
      });

      if (outcome.created) result.raised += 1;
      else if (outcome.reason === "already_open") result.skippedAlreadyOpen += 1;
      else if (outcome.reason === "no_employee") result.skippedNoCoach += 1;
      else result.skippedNoTrigger += 1;
    } catch (err) {
      // One employee's failure must not abandon the rest of the week.
      logger.error(
        { err, employeeId: row.employee_id, weekStart: start },
        "[WeeklyCoaching] failed to evaluate one employee — continuing",
      );
    }
  }

  if (result.skippedMissingTarget > 0) {
    // Loud on purpose: a run that evaluates people and raises nothing because
    // no target exists looks identical to a healthy quiet week in the logs.
    logger.warn(
      result,
      `[WeeklyCoaching] ${start}..${end}: ${result.skippedMissingTarget} employee(s) across ` +
      `${result.processesMissingTarget.length} process(es) had quality but no approved QUALITY_SCORE target, ` +
      `so no coaching can be raised for them. Affected: ` +
      `${result.processesMissingTarget.map((p) => `${p.processName} (${p.employeeCount})`).join(", ") || "unknown"}.`,
    );
  }
  logger.info(result, `[WeeklyCoaching] ${start}..${end}: raised ${result.raised} of ${result.evaluated} evaluated`);
  return result;
}
