import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { type DashboardScope, buildScopeWhere } from "../../shared/dashboardScope.js";

export interface DrilldownResult {
  metricCode: string;
  records: unknown[];
  note?: string;
  totalCount?: number;
}

export async function getDrilldown(
  metricCode: string,
  scope: DashboardScope,
  filters?: Record<string, unknown>
): Promise<DrilldownResult> {
  switch (metricCode) {
    case "HEADCOUNT":
      return drillHeadcount(scope);
    case "ONBOARDING_PENDING":
      return drillOnboardingPending(scope);
    case "TAT_BREACHED":
      return drillTatBreached(scope);
    case "NAME_MISMATCH":
      return drillNameMismatch(scope);
    case "INCENTIVE_PENDING":
      return drillIncentivePending(scope);
    case "RESIGNATION_PENDING":
      return drillResignationPending(scope);
    default:
      return {
        metricCode,
        records: [],
        note: `Drilldown not yet implemented for ${metricCode}`,
      };
  }
}

// ─── HEADCOUNT: grouped by branch ────────────────────────────────────────────
async function drillHeadcount(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.branch_id AS branchId,
         b.branch_name AS branchName,
         COUNT(*) AS count
       FROM employees e
       LEFT JOIN branches b ON b.id = e.branch_id
       WHERE e.status = 'active' AND ${scopeSql}
       GROUP BY e.branch_id, b.branch_name
       ORDER BY count DESC`,
      scopeParams
    );

    return {
      metricCode: "HEADCOUNT",
      records: rows.map((r: any) => ({
        branchId: r.branchId,
        branchName: r.branchName ?? "Unknown",
        count: Number(r.count),
      })),
      totalCount: (rows as any[]).reduce((a, r: any) => a + Number(r.count), 0),
    };
  } catch (err: any) {
    return { metricCode: "HEADCOUNT", records: [], note: `Query error: ${err?.message}` };
  }
}

// ─── ONBOARDING_PENDING: grouped by status with top 10 candidates ─────────────
async function drillOnboardingPending(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "b.branch_id", "b.process_id");

    const [statusRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         bridge_status AS status,
         COUNT(*) AS count
       FROM ats_onboarding_bridge b
       WHERE ${scopeSql}
       GROUP BY bridge_status
       ORDER BY count DESC`,
      scopeParams
    );

    const [topRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         b.id AS bridgeId,
         b.candidate_id AS candidateId,
         CONCAT(c.first_name, ' ', c.last_name) AS candidateName,
         b.bridge_status AS status,
         b.created_at AS createdAt
       FROM ats_onboarding_bridge b
       LEFT JOIN ats_candidate c ON c.id = b.candidate_id
       WHERE b.bridge_status IN ('pending','initiated','stuck') AND ${scopeSql}
       ORDER BY b.created_at ASC
       LIMIT 10`,
      scopeParams
    ).catch(() => [[]] as any);

    return {
      metricCode: "ONBOARDING_PENDING",
      records: (statusRows as any[]).map((r: any) => ({
        status: r.status,
        count: Number(r.count),
        candidates: (topRows as any[])
          .filter((c: any) => c.status === r.status)
          .map((c: any) => ({
            bridgeId: c.bridgeId,
            candidateId: c.candidateId,
            candidateName: c.candidateName ?? "—",
            createdAt: c.createdAt,
          })),
      })),
    };
  } catch (err: any) {
    return { metricCode: "ONBOARDING_PENDING", records: [], note: `Query error: ${err?.message}` };
  }
}

// ─── TAT_BREACHED ─────────────────────────────────────────────────────────────
async function drillTatBreached(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         t.id AS taskId,
         t.task_type AS taskType,
         t.entity_id AS entityId,
         t.due_at AS dueAt,
         TIMESTAMPDIFF(HOUR, t.due_at, NOW()) AS ageHours,
         t.assigned_to_role AS assignedToRole
       FROM task_tat_instance t
       WHERE t.status = 'sla_breached'
       ORDER BY t.due_at ASC
       LIMIT 100`
    );

    return {
      metricCode: "TAT_BREACHED",
      records: (rows as any[]).map((r: any) => ({
        taskId: r.taskId,
        taskType: r.taskType,
        entityId: r.entityId,
        dueAt: r.dueAt,
        ageHours: Number(r.ageHours ?? 0),
        assignedToRole: r.assignedToRole,
      })),
      totalCount: rows.length,
    };
  } catch (err: any) {
    return { metricCode: "TAT_BREACHED", records: [], note: `Query error: ${err?.message}` };
  }
}

// ─── NAME_MISMATCH ────────────────────────────────────────────────────────────
async function drillNameMismatch(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         nm.candidate_id AS candidateId,
         CONCAT(c.first_name, ' ', c.last_name) AS name,
         nm.mismatch_fields AS mismatches,
         nm.is_blocking AS blocking,
         nm.match_status AS matchStatus,
         nm.created_at AS detectedAt
       FROM candidate_name_match_summary nm
       LEFT JOIN ats_candidate c ON c.id = nm.candidate_id
       WHERE nm.match_status IN ('mismatch','partial','pending')
       ORDER BY nm.is_blocking DESC, nm.created_at ASC
       LIMIT 100`
    );

    return {
      metricCode: "NAME_MISMATCH",
      records: (rows as any[]).map((r: any) => ({
        candidateId: r.candidateId,
        name: r.name ?? "—",
        mismatches: r.mismatches,
        blocking: Boolean(r.blocking),
        matchStatus: r.matchStatus,
        detectedAt: r.detectedAt,
      })),
      totalCount: rows.length,
    };
  } catch (err: any) {
    return { metricCode: "NAME_MISMATCH", records: [], note: `Query error: ${err?.message}` };
  }
}

// ─── INCENTIVE_PENDING ────────────────────────────────────────────────────────
async function drillIncentivePending(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         b.id AS batchId,
         b.batch_name AS batchName,
         b.total_amount AS amount,
         b.batch_status AS batchStatus,
         s.step_name AS currentStep,
         s.required_role AS pendingRole,
         b.created_at AS createdAt
       FROM incentive_upload_batch b
       LEFT JOIN incentive_approval_step s
         ON s.batch_id = b.id AND s.step_status = 'pending'
       WHERE b.batch_status = 'pending'
       ORDER BY b.created_at ASC
       LIMIT 100`
    );

    return {
      metricCode: "INCENTIVE_PENDING",
      records: (rows as any[]).map((r: any) => ({
        batchId: r.batchId,
        batchName: r.batchName ?? `Batch #${r.batchId}`,
        amount: Number(r.amount ?? 0),
        currentStep: r.currentStep ?? "Unknown",
        pendingRole: r.pendingRole ?? null,
        createdAt: r.createdAt,
      })),
      totalCount: rows.length,
    };
  } catch (err: any) {
    return { metricCode: "INCENTIVE_PENDING", records: [], note: `Query error: ${err?.message}` };
  }
}

// ─── RESIGNATION_PENDING ──────────────────────────────────────────────────────
async function drillResignationPending(scope: DashboardScope): Promise<DrilldownResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "er.branch_id", "er.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         er.id AS exitId,
         CONCAT(e.first_name, ' ', e.last_name) AS employeeName,
         er.submitted_at AS submittedAt,
         DATEDIFF(NOW(), er.submitted_at) AS daysPending,
         er.exit_status AS exitStatus,
         er.exit_reason AS exitReason
       FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
       WHERE er.exit_status NOT IN ('completed','cancelled') AND ${scopeSql}
       ORDER BY er.submitted_at ASC`,
      scopeParams
    );

    return {
      metricCode: "RESIGNATION_PENDING",
      records: (rows as any[]).map((r: any) => ({
        exitId: r.exitId,
        employeeName: r.employeeName ?? "—",
        submittedAt: r.submittedAt,
        daysPending: Number(r.daysPending ?? 0),
        exitStatus: r.exitStatus,
        exitReason: r.exitReason,
      })),
      totalCount: rows.length,
    };
  } catch (err: any) {
    return { metricCode: "RESIGNATION_PENDING", records: [], note: `Query error: ${err?.message}` };
  }
}
