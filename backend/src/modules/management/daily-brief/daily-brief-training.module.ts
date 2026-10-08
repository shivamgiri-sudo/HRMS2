/**
 * LMS / Training module for the D-1 Daily Manager Briefing Engine.
 *
 * Read-only against the existing synced snapshot tables ONLY — no new LMS logic, no new sync
 * behaviour, per CLAUDE.md's LMS Integration Rule and per the governing prompt for this module.
 *
 * Reuses verified-live columns (confirmed against the live schema, not guessed):
 *   - lms_learning_progress_snapshot: employee_id, course_name, completion_pct, status
 *     ('not_started','in_progress','completed','failed'), last_accessed, synced_at, due_date,
 *     course_duration_hours.
 *   - lms_certification_snapshot: employee_id, certification_name, issued_date, expiry_date,
 *     status ('active','expired','revoked'), synced_at.
 * `synced_at` (modules/lms/lms.sync.service.ts's own INSERT ... synced_at = NOW() on every
 * sync) is the real sync-timestamp column reused here to drive STALE detection.
 *
 * "Overdue mandatory training": lms_learning_progress_snapshot HAS a real `due_date` column,
 * so overdue is computed (due_date < today AND status <> 'completed') rather than omitted. But
 * there is NO separate "mandatory" flag column anywhere in this table — the prompt's own
 * fallback ("omit entirely if no due-date/mandatory-flag concept exists") does not strictly
 * apply since due_date alone does exist, but treating "has a due_date" as "is mandatory" is
 * this module's own editorial assumption, not a copied rule. Flagged for product sign-off.
 *
 * EDITORIAL DEFAULTS (not sourced from an existing convention — flagged for review):
 *  - STALE threshold: no existing "stale" threshold constant was found anywhere in the
 *    codebase for LMS sync freshness. This module uses 24 hours as its own default and reports
 *    the exact staleness in the SourceHealth detail string (e.g. "LMS data last synced 11h
 *    ago" / "... 30h ago (stale)"). Needs product sign-off before being treated as a real SLA.
 *  - "Courses completed D-1": there is no completed_at/completion timestamp column on
 *    lms_learning_progress_snapshot — only last_accessed (nullable) and synced_at (write time).
 *    This module uses `status = 'completed' AND DATE(last_accessed) = D-1` as a proxy, on the
 *    assumption that last_accessed is updated when a learner finishes a course. This is NOT a
 *    verified completion-date field and should be treated as approximate until confirmed with
 *    the LMS integration owner.
 *  - Team completion % is computed as COUNT(status='completed') / COUNT(*) over the team's
 *    course rows (i.e. % of course enrolments complete, not % of employees who are 100% done)
 *    — no existing convention for which denominator to use was found.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { BriefSignal, SourceHealth } from "./daily-brief.types.js";
import { LMS_STALE_THRESHOLD_HOURS as STALE_THRESHOLD_HOURS } from "./daily-brief-editorial-constants.js";

export interface TrainingModuleResult {
  applicable: boolean;
  coursesCompletedD1: BriefSignal | null;
  coursesInProgress: BriefSignal | null;
  overdueMandatoryTraining: BriefSignal | null;
  completionPct: BriefSignal | null;
  certificationsExpiring30d: BriefSignal | null;
  certificationsExpired: BriefSignal | null;
  sourceHealth: SourceHealth[];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAgo(hours: number): string {
  if (hours < 1) return "under 1h ago";
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function resolveFreshness(
  teamEmployeeIds: string[],
): Promise<{ state: "AVAILABLE" | "STALE" | "NO_DATA"; detail?: string; lastSyncedAt: string | null }> {
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(synced_at) AS last_synced
       FROM lms_learning_progress_snapshot
      WHERE employee_id IN (${placeholders})`,
    teamEmployeeIds,
  );
  const lastSynced = rows[0]?.last_synced ? new Date(rows[0].last_synced as string) : null;
  if (!lastSynced) {
    return { state: "NO_DATA", lastSyncedAt: null };
  }
  const ageHours = (Date.now() - lastSynced.getTime()) / (1000 * 60 * 60);
  const ago = formatAgo(ageHours);
  if (ageHours > STALE_THRESHOLD_HOURS) {
    return { state: "STALE", detail: `LMS data last synced ${ago} (older than ${STALE_THRESHOLD_HOURS}h — editorial threshold, needs sign-off)`, lastSyncedAt: lastSynced.toISOString() };
  }
  return { state: "AVAILABLE", detail: `LMS data last synced ${ago}`, lastSyncedAt: lastSynced.toISOString() };
}

async function buildProgressSignals(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<{
  completedD1: BriefSignal | null;
  inProgress: BriefSignal | null;
  overdue: BriefSignal | null;
  completionPct: BriefSignal | null;
  health: SourceHealth;
}> {
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const freshness = await resolveFreshness(teamEmployeeIds);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_rows,
         SUM(status = 'completed' AND DATE(last_accessed) = ?) AS completed_d1,
         SUM(status = 'in_progress') AS in_progress,
         SUM(due_date IS NOT NULL AND due_date < CURDATE() AND status <> 'completed') AS overdue,
         SUM(status = 'completed') AS completed_total
         FROM lms_learning_progress_snapshot
        WHERE employee_id IN (${placeholders})`,
      [reportingDate, ...teamEmployeeIds],
    );
    const row = rows[0] ?? {};
    const total = numberValue(row.total_rows);
    const completedTotal = numberValue(row.completed_total);
    const pct = total > 0 ? Number(((completedTotal / total) * 100).toFixed(2)) : null;

    return {
      completedD1: { key: "training_courses_completed_d1", label: "Courses completed (D-1)", value: numberValue(row.completed_d1), unit: "count" },
      inProgress: { key: "training_courses_in_progress", label: "Courses in progress", value: numberValue(row.in_progress), unit: "count" },
      overdue: { key: "training_overdue_mandatory", label: "Overdue mandatory training", value: numberValue(row.overdue), unit: "count" },
      completionPct: { key: "training_completion_pct", label: "Training completion", value: pct, unit: "percent" },
      health: {
        module: "training_progress",
        state: freshness.state === "STALE" ? "STALE" : total > 0 ? "AVAILABLE" : "NO_DATA",
        detail: freshness.detail,
        asOfDate: reportingDate,
      },
    };
  } catch (err) {
    return {
      completedD1: null,
      inProgress: null,
      overdue: null,
      completionPct: null,
      health: {
        module: "training_progress",
        state: "ERROR",
        detail: `Learning-progress query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildCertificationSignals(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<{ expiring30d: BriefSignal | null; expired: BriefSignal | null; health: SourceHealth }> {
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(status = 'active' AND expiry_date IS NOT NULL AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS expiring_30d,
         SUM(status = 'expired' OR (expiry_date IS NOT NULL AND expiry_date < CURDATE())) AS expired
         FROM lms_certification_snapshot
        WHERE employee_id IN (${placeholders})`,
      teamEmployeeIds,
    );
    const row = rows[0] ?? {};
    return {
      expiring30d: { key: "training_certifications_expiring_30d", label: "Certifications expiring (30 days)", value: numberValue(row.expiring_30d), unit: "count" },
      expired: { key: "training_certifications_expired", label: "Certifications expired", value: numberValue(row.expired), unit: "count" },
      health: { module: "training_certifications", state: "AVAILABLE", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      expiring30d: null,
      expired: null,
      health: {
        module: "training_certifications",
        state: "ERROR",
        detail: `Certification query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

export async function buildTrainingModule(
  teamEmployeeIds: string[],
  reportingDate: string,
): Promise<TrainingModuleResult> {
  if (teamEmployeeIds.length === 0) {
    const health: SourceHealth = { module: "training_progress", state: "NOT_APPLICABLE", detail: "No team members in scope", asOfDate: reportingDate };
    return {
      applicable: false,
      coursesCompletedD1: null,
      coursesInProgress: null,
      overdueMandatoryTraining: null,
      completionPct: null,
      certificationsExpiring30d: null,
      certificationsExpired: null,
      sourceHealth: [health, { ...health, module: "training_certifications" }],
    };
  }

  const [progressResult, certResult] = await Promise.all([
    buildProgressSignals(teamEmployeeIds, reportingDate),
    buildCertificationSignals(teamEmployeeIds, reportingDate),
  ]);

  return {
    applicable: true,
    coursesCompletedD1: progressResult.completedD1,
    coursesInProgress: progressResult.inProgress,
    overdueMandatoryTraining: progressResult.overdue,
    completionPct: progressResult.completionPct,
    certificationsExpiring30d: certResult.expiring30d,
    certificationsExpired: certResult.expired,
    sourceHealth: [progressResult.health, certResult.health],
  };
}
