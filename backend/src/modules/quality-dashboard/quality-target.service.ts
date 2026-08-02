import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Per-process quality thresholds: reading them, changing them, and predicting
 * what a change would do before anyone commits to it.
 *
 * The evaluator raised nothing for 41 agents on 2026-08-02 because no target
 * existed anywhere. Nothing here invents one. A process without an approved
 * target stays unjudged, and the absence is reported rather than filled in.
 *
 * Thresholds are percentages OF TARGET, so one policy reads the same on a
 * process targeting 45 and one targeting 85 — the same relative rule the
 * coaching trigger already applies.
 */

export class QualityTargetError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

export type QualityTarget = {
  id: string;
  processId: string;
  processName?: string;
  metricCode: string;
  targetScore: number;
  warningThresholdPct: number;
  criticalThresholdPct: number;
  minAuditCount: number;
  evaluationPeriod: "daily" | "weekly" | "monthly";
  effectiveFrom: string;
  effectiveTo: string | null;
  status:
    | "draft" | "simulation_reviewed" | "pending_approval" | "approved"
    | "active" | "inactive" | "superseded" | "rejected";
  approvedBy: string | null;
  approvedAt: string | null;
};

function toTarget(row: RowDataPacket): QualityTarget {
  return {
    id: String(row.id),
    processId: String(row.process_id),
    processName: row.process_name ? String(row.process_name) : undefined,
    metricCode: String(row.metric_code),
    targetScore: Number(row.target_score),
    warningThresholdPct: Number(row.warning_threshold_pct),
    criticalThresholdPct: Number(row.critical_threshold_pct),
    minAuditCount: Number(row.min_audit_count),
    evaluationPeriod: row.evaluation_period,
    effectiveFrom: String(row.effective_from).slice(0, 10),
    effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
    status: row.status,
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
  };
}

async function recordAudit(input: {
  targetId: string; processId: string;
  action: "created" | "updated" | "approved" | "activated" | "superseded" | "retired";
  before?: unknown; after?: unknown; reason?: string | null; actorUserId?: string | null;
}, conn?: { execute: (sql: string, params: unknown[]) => Promise<unknown> }): Promise<void> {
  const exec = conn ?? db;
  await exec.execute(
    `INSERT INTO process_quality_target_audit
       (target_id, process_id, action, before_json, after_json, reason, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.targetId, input.processId, input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.reason ?? null, input.actorUserId ?? null,
    ],
  );
}

/**
 * The target governing a process on a date, or null.
 *
 * Only `active` counts. A draft has not been approved, and a superseded or
 * retired one describes a period that has passed — using either would judge
 * somebody against a policy nobody agreed to.
 */
export async function resolveQualityTarget(
  processId: string,
  asOf: string,
  metricCode = "QUALITY_SCORE",
): Promise<QualityTarget | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.*, p.process_name
       FROM process_quality_target t
       JOIN process_master p ON p.id = t.process_id
      WHERE t.process_id = ? AND t.metric_code = ?
        AND t.status = 'active' AND t.active_status = 1
        AND t.effective_from <= ?
        AND (t.effective_to IS NULL OR t.effective_to >= ?)
      ORDER BY t.effective_from DESC LIMIT 1`,
    [processId, metricCode, asOf, asOf],
  );
  return rows[0] ? toTarget(rows[0]) : null;
}

/** Every version for a process, newest first, for the config screen. */
export async function listQualityTargets(processId: string): Promise<QualityTarget[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.*, p.process_name FROM process_quality_target t
       JOIN process_master p ON p.id = t.process_id
      WHERE t.process_id = ? ORDER BY t.metric_code, t.effective_from DESC`,
    [processId],
  );
  return rows.map(toTarget);
}

/** Which processes have no active target — the gap, named. */
export async function listProcessesMissingTarget(
  asOf: string,
  metricCode = "QUALITY_SCORE",
): Promise<Array<{ processId: string; processName: string; employeesWithQuality: number }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id AS process_id, p.process_name,
            COUNT(DISTINCT e.id) AS employees_with_quality
       FROM process_master p
       JOIN employees e ON e.process_id = p.id
       JOIN kpi_daily_actual k ON k.employee_id = e.id
       JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = ?
      WHERE p.active_status = 1
        AND k.score_date >= DATE_SUB(?, INTERVAL 30 DAY)
        AND NOT EXISTS (
          SELECT 1 FROM process_quality_target t
           WHERE t.process_id = p.id AND t.metric_code = ?
             AND t.status = 'active' AND t.active_status = 1
             AND t.effective_from <= ?
             AND (t.effective_to IS NULL OR t.effective_to >= ?)
        )
      GROUP BY p.id, p.process_name
      ORDER BY employees_with_quality DESC`,
    [metricCode, asOf, metricCode, asOf, asOf],
  );
  return rows.map((r) => ({
    processId: String(r.process_id),
    processName: String(r.process_name),
    employeesWithQuality: Number(r.employees_with_quality),
  }));
}

export type CreateTargetInput = {
  processId: string;
  metricCode?: string;
  targetScore: number;
  warningThresholdPct?: number;
  criticalThresholdPct?: number;
  minAuditCount?: number;
  evaluationPeriod?: "daily" | "weekly" | "monthly";
  effectiveFrom: string;
  createdBy?: string | null;
};

/** Create a DRAFT. A draft governs nothing until it is approved. */
export async function createQualityTarget(input: CreateTargetInput): Promise<{ id: string }> {
  const warning = input.warningThresholdPct ?? 90;
  const critical = input.criticalThresholdPct ?? 75;

  if (!(input.targetScore > 0 && input.targetScore <= 100)) {
    throw new QualityTargetError("Target score must be above 0 and at most 100");
  }
  if (!(warning > critical)) {
    // Inverted bands make every shortfall read as critical, which is the same
    // as having no bands at all.
    throw new QualityTargetError("The warning threshold must sit above the critical threshold");
  }
  if ((input.minAuditCount ?? 3) < 1) {
    throw new QualityTargetError("At least one audit is required to judge anybody");
  }

  const id = randomUUID();
  const metricCode = input.metricCode ?? "QUALITY_SCORE";

  const [clash] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_quality_target
      WHERE process_id = ? AND metric_code = ? AND effective_from = ? LIMIT 1`,
    [input.processId, metricCode, input.effectiveFrom],
  );
  if (clash.length) {
    throw new QualityTargetError(
      "A target already starts on that date for this process — pick a later effective date", 409,
    );
  }

  await db.execute(
    `INSERT INTO process_quality_target
       (id, process_id, metric_code, target_score, warning_threshold_pct, critical_threshold_pct,
        min_audit_count, evaluation_period, effective_from, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [
      id, input.processId, metricCode, input.targetScore, warning, critical,
      input.minAuditCount ?? 3, input.evaluationPeriod ?? "weekly",
      input.effectiveFrom, input.createdBy ?? null,
    ],
  );
  await recordAudit({
    targetId: id, processId: input.processId, action: "created",
    after: { ...input, warningThresholdPct: warning, criticalThresholdPct: critical },
    actorUserId: input.createdBy ?? null,
  });
  return { id };
}

/**
 * REMOVED — this used to flip a draft straight to active in one call.
 *
 * 1058 replaced it with a lifecycle (simulate, submit, approve, activate) whose
 * point is that none of those steps can be skipped: an approval has to follow a
 * simulation of the same numbers, and the approver cannot be the author. Leaving
 * the old one-shot in place would have kept a second door into `active` that
 * honours none of that.
 *
 * It throws rather than being deleted so that any caller missed during the
 * change fails loudly here instead of quietly bypassing governance.
 *
 * @deprecated Use quality-target-transition.ts.
 */
export async function approveQualityTarget(
  _targetId: string, _approverUserId: string, _note?: string | null,
): Promise<never> {
  throw new QualityTargetError(
    "Targets are no longer approved in one step. Simulate the target, submit it for approval, "
      + "have a second approver approve it, then activate it — see quality-target-transition.ts.",
    410,
  );
}

/** The change history for a process, newest first. */
export async function getTargetHistory(processId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.*, t.metric_code, t.target_score, t.effective_from
       FROM process_quality_target_audit a
       LEFT JOIN process_quality_target t ON t.id = a.target_id
      WHERE a.process_id = ? ORDER BY a.created_at DESC LIMIT 200`,
    [processId],
  );
  return rows;
}
