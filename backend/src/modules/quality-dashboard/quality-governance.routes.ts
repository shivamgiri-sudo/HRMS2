import { Router, type Response } from "express";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  listQualityTargets, listProcessesMissingTarget, createQualityTarget,
  approveQualityTarget, getTargetHistory, resolveQualityTarget, QualityTargetError,
} from "./quality-target.service.js";
import { simulateQualityTarget } from "./quality-target-simulation.js";

/**
 * Governance for quality thresholds, and the health view that shows whether the
 * quality pipeline is doing anything.
 *
 * Nothing here invents a target. A process without an approved one stays
 * unjudged and is reported as such — the gap is the finding, not something to
 * paper over.
 */

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(requireAuth);

/** Setting the bar people are judged against is a QA-lead and management act. */
const TARGET_ADMIN = ["super_admin", "admin", "qa", "tq_head"] as const;
/** Approving it is deliberately narrower than drafting it. */
const TARGET_APPROVER = ["super_admin", "admin", "tq_head"] as const;
const HEALTH_VIEWERS = [
  "super_admin", "admin", "qa", "quality_analyst", "tq_head",
  "operations_manager", "process_manager", "branch_head", "ceo", "coo",
] as const;

function fail(res: Response, err: unknown): Response {
  if (err instanceof QualityTargetError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  throw err;
}

const today = () => new Date().toISOString().slice(0, 10);

/** GET /api/quality-governance/targets?processId= */
router.get("/targets", requireRole(...TARGET_ADMIN), h(async (req, res) => {
  const processId = String(req.query.processId ?? "").trim();
  if (!processId) return res.status(400).json({ success: false, message: "processId is required" });
  return res.json({
    success: true,
    data: await listQualityTargets(processId),
    active: await resolveQualityTarget(processId, today()),
  });
}));

/** GET /api/quality-governance/targets/missing — the gap, named per process. */
router.get("/targets/missing", requireRole(...HEALTH_VIEWERS), h(async (_req, res) => {
  const missing = await listProcessesMissingTarget(today());
  return res.json({
    success: true,
    data: missing,
    totalEmployeesAffected: missing.reduce((n, m) => n + m.employeesWithQuality, 0),
  });
}));

/** POST /api/quality-governance/targets — create a DRAFT. Governs nothing yet. */
router.post("/targets", requireRole(...TARGET_ADMIN), h(async (req, res) => {
  const { processId, metricCode, targetScore, warningThresholdPct, criticalThresholdPct,
          minAuditCount, evaluationPeriod, effectiveFrom } = req.body ?? {};
  if (!processId || targetScore === undefined || !effectiveFrom) {
    return res.status(400).json({
      success: false, message: "processId, targetScore and effectiveFrom are required",
    });
  }
  try {
    const result = await createQualityTarget({
      processId: String(processId),
      metricCode: metricCode ? String(metricCode) : undefined,
      targetScore: Number(targetScore),
      warningThresholdPct: warningThresholdPct === undefined ? undefined : Number(warningThresholdPct),
      criticalThresholdPct: criticalThresholdPct === undefined ? undefined : Number(criticalThresholdPct),
      minAuditCount: minAuditCount === undefined ? undefined : Number(minAuditCount),
      evaluationPeriod,
      effectiveFrom: String(effectiveFrom).slice(0, 10),
      createdBy: req.authUser!.id,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) { return fail(res, err); }
}));

/**
 * POST /api/quality-governance/targets/:id/approve
 * Approves AND activates, superseding the previous policy in one transaction.
 */
router.post("/targets/:id/approve", requireRole(...TARGET_APPROVER), h(async (req, res) => {
  try {
    // The approver comes from the session. Approving the bar an entire process
    // is judged against has to name whoever actually did it.
    const result = await approveQualityTarget(
      String(req.params.id), req.authUser!.id, req.body?.note ?? null,
    );
    return res.json({ success: true, data: result });
  } catch (err) { return fail(res, err); }
}));

/** GET /api/quality-governance/targets/:processId/history */
router.get("/targets/:processId/history", requireRole(...TARGET_ADMIN), h(async (req, res) => {
  return res.json({ success: true, data: await getTargetHistory(String(req.params.processId)) });
}));

/**
 * POST /api/quality-governance/simulate
 * What a proposed threshold would do, before anyone approves it. Read-only.
 */
router.post("/simulate", requireRole(...TARGET_ADMIN), h(async (req, res) => {
  const { processId, targetScore } = req.body ?? {};
  if (!processId || targetScore === undefined) {
    return res.status(400).json({ success: false, message: "processId and targetScore are required" });
  }
  const result = await simulateQualityTarget({
    processId: String(processId),
    targetScore: Number(targetScore),
    warningThresholdPct: req.body.warningThresholdPct === undefined ? undefined : Number(req.body.warningThresholdPct),
    criticalThresholdPct: req.body.criticalThresholdPct === undefined ? undefined : Number(req.body.criticalThresholdPct),
    minAuditCount: req.body.minAuditCount === undefined ? undefined : Number(req.body.minAuditCount),
    lookbackWeeks: req.body.lookbackWeeks === undefined ? undefined : Number(req.body.lookbackWeeks),
  });
  return res.json({ success: true, data: result });
}));

/**
 * GET /api/quality-governance/health
 *
 * Separates the states that all previously looked like "nothing happened":
 * a failing job, a disabled job, missing configuration, no data arriving, data
 * arriving but nothing triggered, and triggers actually raised. Conflating any
 * two of these is what let 864 connector failures and a completely inert
 * coaching loop both read as quiet.
 */
router.get("/health", requireRole(...HEALTH_VIEWERS), h(async (_req, res) => {
  const since = "DATE_SUB(NOW(), INTERVAL 24 HOUR)";

  const [connectorRuns] = await db.execute<RowDataPacket[]>(
    `SELECT integration_key, status, COUNT(*) AS runs, MAX(started_at) AS latest,
            SUM(COALESCE(rows_promoted,0)) AS promoted
       FROM integration_connector_run
      WHERE started_at >= ${since}
      GROUP BY integration_key, status ORDER BY latest DESC`,
  );

  const [schedules] = await db.execute<RowDataPacket[]>(
    `SELECT integration_key, cron_expression, enabled, last_run_at FROM integration_schedule
      ORDER BY enabled DESC, integration_key`,
  );

  // Data arrived, per source, in the last day.
  const [ingest] = await db.execute<RowDataPacket[]>(
    `SELECT 'quality' AS stream, COUNT(*) AS rows_, MAX(k.score_date) AS latest_date, MAX(k.created_at) AS last_write
       FROM kpi_daily_actual k JOIN kpi_metric_master m ON m.id = k.metric_id
      WHERE m.metric_code = 'QUALITY_SCORE'
     UNION ALL
     SELECT 'call_daily', COUNT(*), MAX(activity_date), MAX(created_at) FROM integration_call_daily
     UNION ALL
     SELECT 'biometric_daily', COUNT(*), MAX(activity_date), MAX(created_at) FROM integration_biometric_daily`,
  );

  const missingTargets = await listProcessesMissingTarget(today());

  const [coaching] = await db.execute<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS n, MAX(created_at) AS latest
       FROM coaching_session GROUP BY status`,
  );

  const [unmapped] = await db.execute<RowDataPacket[]>(
    `SELECT source_system, exception_type, COUNT(*) AS n
       FROM integration_mapping_exception WHERE status = 'open'
      GROUP BY source_system, exception_type`,
  );

  const disabled = (schedules as RowDataPacket[]).filter((s) => !Number(s.enabled));
  const failed = (connectorRuns as RowDataPacket[]).filter((r) => r.status === "failed");
  const succeeded = (connectorRuns as RowDataPacket[]).filter((r) => r.status === "complete");
  const totalCoaching = (coaching as RowDataPacket[]).reduce((n, c) => n + Number(c.n), 0);

  return res.json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      // Each of these is a DIFFERENT answer to "why is nothing happening".
      successfulRuns: succeeded,
      failedRuns: failed,
      disabledSchedules: disabled.map((s) => ({
        integrationKey: String(s.integration_key),
        cron: String(s.cron_expression),
        lastRunAt: s.last_run_at,
      })),
      missingConfiguration: {
        processesWithoutQualityTarget: missingTargets,
        employeesAffected: missingTargets.reduce((n, m) => n + m.employeesWithQuality, 0),
      },
      dataStreams: ingest,
      // Data arrived and produced no coaching. Distinct from "no data" and from
      // "missing configuration" — this one means people met their targets.
      dataReceivedNoTrigger: totalCoaching === 0 && missingTargets.length === 0,
      triggersRaised: { total: totalCoaching, byStatus: coaching },
      openMappingExceptions: unmapped,
    },
  });
}));

export { router as qualityGovernanceRouter };
