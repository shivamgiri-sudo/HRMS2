import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { evaluateCoachingTrigger } from "./coaching-trigger.js";

/**
 * What a proposed threshold would actually do, before anyone approves it.
 *
 * A target is a decision about how many people get a difficult conversation
 * every week. Setting one blind is how a quality programme either does nothing
 * or floods a team it cannot staff — and with 16 of 46 July agents below 60%,
 * both failure modes are live possibilities here.
 *
 * This runs the proposed numbers over real history and reports the consequences
 * without writing anything. Deliberately read-only: a simulation that could
 * change state is not a simulation.
 */

export type SimulationInput = {
  processId: string;
  targetScore: number;
  warningThresholdPct?: number;
  criticalThresholdPct?: number;
  minAuditCount?: number;
  /** How many weeks of history to score the proposal against. */
  lookbackWeeks?: number;
  metricCode?: string;
};

export type SimulatedEmployee = {
  employeeId: string;
  employeeCode: string;
  avgQuality: number;
  auditCount: number;
  ratioOfTarget: number;
  band: "critical" | "warning" | "ok";
  /** What evaluateCoachingTrigger — the weekly worker's own function — says. */
  wouldTrigger: boolean;
};

export type SimulationResult = {
  processId: string;
  processName: string;
  windowFrom: string;
  windowTo: string;
  targetScore: number;
  /** Employees with any quality in the window. */
  employeesEvaluated: number;
  /** Would produce a coaching session. */
  wouldTrigger: number;
  wouldTriggerPct: number;
  criticalCount: number;
  warningCount: number;
  /** Had quality but fewer audits than min_audit_count — judged on nothing. */
  insufficientAudits: number;
  /**
   * Had rows but no assessed score. Reported, never judged: coaching someone
   * because their audits went unscored punishes them for a process failure.
   */
  unassessed: number;
  /** Would trigger on the strength of a single audit, had the minimum allowed it. */
  singleAuditTriggers: number;
  /** Weekly coaching sessions this implies, at the configured period. */
  expectedWeeklyCoachingLoad: number;
  /** True when the trigger rate is far above what a team can absorb. */
  unusuallyHighTriggerRate: boolean;
  employees: SimulatedEmployee[];
  notes: string[];
};

/**
 * A trigger rate above this is flagged. Not a hard limit — a genuinely
 * struggling process may deserve it — but a rate this high usually means the
 * target is wrong rather than that everyone is failing.
 */
const HIGH_TRIGGER_RATE = 0.5;

export async function simulateQualityTarget(input: SimulationInput): Promise<SimulationResult> {
  const lookbackWeeks = Math.min(Math.max(input.lookbackWeeks ?? 4, 1), 26);
  const metricCode = input.metricCode ?? "QUALITY_SCORE";
  const warningPct = input.warningThresholdPct ?? 90;
  const criticalPct = input.criticalThresholdPct ?? 75;
  const minAudits = input.minAuditCount ?? 3;

  const [[proc]] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_name FROM process_master WHERE id = ? LIMIT 1`, [input.processId],
  ) as unknown as [RowDataPacket[], unknown];
  if (!proc) throw new Error(`Process not found: ${input.processId}`);

  // Real history, per employee, over the lookback window.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT k.employee_id, e.employee_code,
            ROUND(AVG(k.actual_value), 2)            AS avg_quality,
            SUM(COALESCE(k.source_record_count, 1))  AS audit_count,
            MIN(k.score_date) AS from_d, MAX(k.score_date) AS to_d
       FROM kpi_daily_actual k
       JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = ?
       JOIN employees e ON e.id = k.employee_id
      WHERE e.process_id = ?
        AND k.score_date >= DATE_SUB(CURDATE(), INTERVAL ? WEEK)
      GROUP BY k.employee_id, e.employee_code`,
    [metricCode, input.processId, lookbackWeeks],
  );

  const employees: SimulatedEmployee[] = [];
  let insufficientAudits = 0, singleAuditTriggers = 0, unassessed = 0;
  let windowFrom = "", windowTo = "";

  // The one place the proposed configuration is expressed as the evaluator
  // understands it. Everything below asks evaluateCoachingTrigger rather than
  // re-deriving the answer.
  const thresholds = {
    warningRatio: warningPct / 100,
    criticalRatio: criticalPct / 100,
    minSample: minAudits,
  };

  for (const r of rows) {
    // NULL means nobody assessed the work. Coercing it to 0 (as this used to)
    // made unassessed employees look like the worst performers on the process,
    // while the worker — correctly — raises nothing for them.
    const avg = r.avg_quality === null || r.avg_quality === undefined ? null : Number(r.avg_quality);
    const audits = Number(r.audit_count ?? 0);
    const ratio = avg !== null && input.targetScore > 0 ? (avg / input.targetScore) * 100 : 0;
    if (!windowFrom || String(r.from_d) < windowFrom) windowFrom = String(r.from_d).slice(0, 10);
    if (!windowTo || String(r.to_d) > windowTo) windowTo = String(r.to_d).slice(0, 10);

    if (avg === null) { unassessed += 1; continue; }

    const wouldBand: SimulatedEmployee["band"] =
      ratio < criticalPct ? "critical" : ratio < warningPct ? "warning" : "ok";

    if (audits < minAudits) {
      insufficientAudits += 1;
      // Counted separately, and specifically flagged when a single audit would
      // have been enough to trigger — that is the case most likely to feel
      // unjust to the person receiving it.
      if (audits <= 1 && wouldBand !== "ok") singleAuditTriggers += 1;
      continue;
    }

    employees.push({
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code),
      avgQuality: avg,
      auditCount: audits,
      ratioOfTarget: Math.round(ratio * 10) / 10,
      band: wouldBand,
      // Asked, not inferred. This is the same function the weekly worker calls,
      // so the count below is a prediction of what would actually happen rather
      // than a second opinion about it.
      wouldTrigger: evaluateCoachingTrigger({
        qualityPercentage: avg,
        fatalTriggered: false,
        targetPercentage: input.targetScore,
        consecutiveShortfalls: 0,
        sampleSize: audits,
        thresholds,
      }) !== null,
    });
  }

  const criticalCount = employees.filter((e) => e.band === "critical").length;
  const warningCount = employees.filter((e) => e.band === "warning").length;
  const wouldTrigger = employees.filter((e) => e.wouldTrigger).length;
  const evaluated = employees.length;
  const rate = evaluated > 0 ? wouldTrigger / evaluated : 0;

  const notes: string[] = [];
  if (evaluated === 0) {
    notes.push(
      insufficientAudits > 0
        ? `No employee on this process has ${minAudits} or more audits in the last ${lookbackWeeks} week(s). Nobody would be judged, and ${insufficientAudits} would be reported as insufficient evidence.`
        : `No quality data at all for this process in the last ${lookbackWeeks} week(s). A target can be set, but nothing will evaluate against it yet.`,
    );
  }
  if (rate >= HIGH_TRIGGER_RATE && evaluated > 0) {
    notes.push(
      `${Math.round(rate * 100)}% of assessed employees would trigger. A rate this high usually means the target is above what this process currently achieves, rather than that most of the team is underperforming.`,
    );
  }
  if (singleAuditTriggers > 0) {
    notes.push(
      `${singleAuditTriggers} employee(s) would have triggered on a single audit if the minimum were lower. The minimum of ${minAudits} is what stops one bad call becoming a coaching record.`,
    );
  }
  if (unassessed > 0) {
    notes.push(
      `${unassessed} employee(s) have quality rows but no assessed score in this window. They are ` +
      `excluded rather than counted as failing — an unscored audit is a process failure, not theirs.`,
    );
  }
  if (insufficientAudits > 0 && evaluated > 0) {
    notes.push(
      `${insufficientAudits} employee(s) have quality but fewer than ${minAudits} audits, so they are reported as insufficient evidence rather than judged.`,
    );
  }

  // Sessions per week implied by this rate, at one per employee per period.
  const perWeek = Math.round((wouldTrigger / Math.max(lookbackWeeks, 1)) * 10) / 10;

  return {
    processId: String(proc.id),
    processName: String(proc.process_name),
    windowFrom: windowFrom || "-",
    windowTo: windowTo || "-",
    targetScore: input.targetScore,
    employeesEvaluated: evaluated,
    wouldTrigger,
    wouldTriggerPct: evaluated > 0 ? Math.round(rate * 1000) / 10 : 0,
    criticalCount,
    warningCount,
    insufficientAudits,
    unassessed,
    singleAuditTriggers,
    expectedWeeklyCoachingLoad: perWeek,
    unusuallyHighTriggerRate: rate >= HIGH_TRIGGER_RATE && evaluated > 0,
    employees: employees.sort((a, b) => a.ratioOfTarget - b.ratioOfTarget).slice(0, 50),
    notes,
  };
}
