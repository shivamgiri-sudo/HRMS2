/**
 * portal.training-compliance.service.ts
 *
 * Client-facing, process-scoped, AGGREGATE-ONLY training compliance rollup for the
 * Quality-Learning Governance feature (training_assignment / skill_category / the shared
 * TAT engine). Modelled directly on portal.attrition.service.ts's shape: same
 * defence-in-depth argument order (processId, period, allowedProcessIds), same period
 * validation, same "null means not-yet-measured, never a fabricated 0" convention.
 *
 * WHY THIS NEVER RETURNS ANYTHING PER-EMPLOYEE
 * -----------------------------------------------
 * This codebase has an explicit, tested precedent for what the client portal may never
 * show: CLIENT_PORTAL_BLOCKED_DATA (role.catalog.ts) lists "employee_personal" and
 * "candidate_pii" as blocked categories, and process-operations.service.ts's own comment on
 * getMetricDrilldownForPortal states the rule directly: "No agent-level attribution, no raw
 * source rows, no PII: those live in ... internal-only [functions], un-mirrored here, until
 * someone makes an explicit decision that a client should see analyst-level [data]." No such
 * decision has been made for training records, so this service — like every query in
 * portal.attrition.service.ts — only ever SELECTs COUNT/AVG/SUM/GROUP BY aggregates. It
 * never selects employees.full_name, employee_code, or any training_assignment row
 * identifiable to one person.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { TrainingComplianceData } from "./portal.types.js";

export const portalTrainingComplianceService = {
  async getTrainingCompliance(
    processId: string,
    period: string,
    allowedProcessIds?: string[]
  ): Promise<TrainingComplianceData> {
    // Defence-in-depth: the controller already calls assertProcessAccess; this layer adds a
    // second check, exactly matching portal.attrition.service.ts's own guard (and required
    // by process-scope-boundary.contract.test.ts's "service still rejects" assertion).
    if (!processId) throw Object.assign(new Error("processId is required"), { statusCode: 400 });
    if (allowedProcessIds !== undefined && !allowedProcessIds.includes(processId)) {
      throw Object.assign(new Error("Process not in your access list"), { statusCode: 403 });
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw Object.assign(new Error(`Invalid period format: ${period}`), { statusCode: 400 });
    }

    if (processId === "p-demo-1") {
      return {
        period,
        compliance_pct: 94.2,
        active_assignment_count: 12,
        pending_mandatory_count: 6,
        breached_count: 1,
        avg_completion_hours: 18.4,
        by_severity: [
          { severity: "CRITICAL", active_count: 1 },
          { severity: "HIGH", active_count: 3 },
          { severity: "MEDIUM", active_count: 6 },
          { severity: "LOW", active_count: 2 },
        ],
      };
    }

    // Assignments created (by created_at, matching the month picker) for this process,
    // joined ONLY to pull employees.process_id — never a name/code column. task_tat_instance
    // supplies status/due_at/completed_at; content-missing assignments (no TAT instance yet)
    // are counted as active-and-pending, never silently dropped from the denominator.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_count,
         SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
         SUM(CASE WHEN t.status IS NULL OR t.status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS active_count,
         SUM(CASE WHEN t.status IS NULL OR t.status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS pending_mandatory_count,
         SUM(CASE WHEN t.due_at IS NOT NULL AND t.due_at < NOW() AND t.status IN ('open','in_progress','sla_breached') THEN 1 ELSE 0 END) AS breached_count,
         AVG(CASE WHEN t.completed_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, ta.created_at, t.completed_at) ELSE NULL END) AS avg_completion_hours
       FROM training_assignment ta
       JOIN employees e ON e.id = ta.employee_id
       LEFT JOIN task_tat_instance t ON t.id = ta.tat_instance_id
      WHERE e.process_id = ?
        AND DATE_FORMAT(ta.created_at, '%Y-%m') = ?`,
      [processId, period]
    );
    const row = (rows as RowDataPacket[])[0];

    const [severityRows] = await db.execute<RowDataPacket[]>(
      `SELECT ta.severity, COUNT(*) AS active_count
         FROM training_assignment ta
         JOIN employees e ON e.id = ta.employee_id
         LEFT JOIN task_tat_instance t ON t.id = ta.tat_instance_id
        WHERE e.process_id = ?
          AND DATE_FORMAT(ta.created_at, '%Y-%m') = ?
          AND (t.status IS NULL OR t.status NOT IN ('completed', 'cancelled'))
        GROUP BY ta.severity`,
      [processId, period]
    );

    const totalCount = Number(row?.total_count) || 0;
    const completedCount = Number(row?.completed_count) || 0;
    // null, not 0%, when this process has never had a single assignment — a genuinely
    // perfect month with zero training required must not read the same as a client with
    // no training program configured yet. Same "null means not measured" rule
    // portal.attrition.service.ts already applies to sanctioned_strength/open_positions.
    const compliance_pct = totalCount > 0
      ? Math.round((completedCount / totalCount) * 100 * 100) / 100
      : null;

    return {
      period,
      compliance_pct,
      active_assignment_count: Number(row?.active_count) || 0,
      pending_mandatory_count: Number(row?.pending_mandatory_count) || 0,
      breached_count: Number(row?.breached_count) || 0,
      avg_completion_hours: row?.avg_completion_hours != null ? Math.round(Number(row.avg_completion_hours) * 10) / 10 : null,
      by_severity: (severityRows as RowDataPacket[]).map((r) => ({
        severity: r.severity,
        active_count: Number(r.active_count),
      })),
    };
  },
};
