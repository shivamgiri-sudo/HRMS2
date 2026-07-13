import { randomUUID } from "crypto";
import type { RowDataPacket, Pool } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { getPoolForKey, testPoolForKey } from "../external-db/external-db.service.js";
import mysql from "mysql2/promise";

function normalizeLookup(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function buildInClause(values: string[]): { clause: string; params: string[] } {
  if (!values.length) return { clause: "NULL", params: [] };
  return {
    clause: values.map(() => "?").join(", "),
    params: values,
  };
}

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Static fallback pool from .env — used only when no Integration Hub credentials are configured.
// Once LMS credentials are saved via Integration Hub (integration_key='lms_sync'),
// getLmsPool() will return the config-driven pool instead.
let _envPool: Pool | null = null;
function getEnvPool(): Pool {
  if (!_envPool) {
    _envPool = mysql.createPool({
      host: env.LMS_DB_HOST,
      port: env.LMS_DB_PORT,
      user: env.LMS_DB_USER,
      password: env.LMS_DB_PASSWORD,
      database: env.LMS_DB_NAME,
      connectionLimit: env.LMS_DB_POOL_MAX,
      waitForConnections: true,
      queueLimit: 0,
      timezone: "local",
      decimalNumbers: true,
    });
  }
  return _envPool;
}

// Returns the active LMS pool. Prefers Integration Hub credentials (lms_sync key).
// Falls back to .env pool when no IH credentials are stored.
export async function getLmsPool(): Promise<Pool> {
  try {
    const pool = await getPoolForKey("lms_sync") as Pool;
    return pool;
  } catch {
    return getEnvPool();
  }
}

export async function lmsQuery<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
  const pool = await getLmsPool();
  const [rows] = await pool.execute<T>(sql, params as any);
  return rows;
}

function hasLmsAdminRole(hrmsRoles: string[]) {
  return hrmsRoles.some((role) => ["admin", "hr", "ceo", "super_admin", "lms_admin"].includes(String(role).toLowerCase()));
}

function hasLmsCoordinatorRole(hrmsRoles: string[], lmsRole?: string | null) {
  const normalized = hrmsRoles.map((role) => String(role).toLowerCase());
  return normalized.some((role) => ["trainer", "quality", "quality_auditor", "qa", "qtl", "training", "training_manager", "lms_coordinator", "coordinator"].includes(role)) || ["coordinator", "trainer", "quality"].includes(String(lmsRole ?? "").toLowerCase());
}

export const lmsService = {
  async testConnection(): Promise<{ ok: boolean; source: "integration_hub" | "env"; latency_ms?: number; error?: string }> {
    const start = Date.now();
    // Try Integration Hub credentials first
    try {
      const result = await testPoolForKey("lms_sync");
      if (result.ok) {
        return { ok: true, source: "integration_hub", latency_ms: Date.now() - start };
      }
    } catch {
      // Fall through to env pool
    }
    // Try env pool
    try {
      const pool = getEnvPool();
      await pool.execute("SELECT 1");
      return { ok: true, source: "env", latency_ms: Date.now() - start };
    } catch (e: any) {
      return { ok: false, source: "env", error: e?.message ?? "Connection failed", latency_ms: Date.now() - start };
    }
  },

  async getAccessForEmployee(employee: any, hrmsRoles: string[]) {
    const employeeCode = String(employee?.employee_code ?? "").trim();
    const userId = String(employee?.user_id ?? "").trim();
    const email = String(employee?.email ?? employee?.official_email ?? "").trim();
    const [roleAccess] = await lmsQuery<RowDataPacket[]>(
      `SELECT * FROM role_access_matrix
        WHERE active = 1
          AND (employee_code = ? OR login_id = ? OR email = ?)
        LIMIT 1`,
      [employeeCode, employeeCode || userId, email],
    );
    const [trainee] = await lmsQuery<RowDataPacket[]>(
      `SELECT * FROM trainee_master
        WHERE employee_id = ? OR permanent_emp_id = ? OR email = ?
        LIMIT 1`,
      [employeeCode, employeeCode, email],
    );
    const canAdmin = hasLmsAdminRole(hrmsRoles) || ["admin", "management"].includes(String(roleAccess?.role ?? "").toLowerCase()) || ["admin", "management"].includes(String(roleAccess?.portal_access ?? "").toLowerCase());
    const canCoordinator = canAdmin || hasLmsCoordinatorRole(hrmsRoles, roleAccess?.role) || ["coordinator", "trainer"].includes(String(roleAccess?.portal_access ?? "").toLowerCase());
    const canEmployee = Boolean(trainee) || Boolean(employeeCode);
    return {
      employeeCode,
      user: {
        employeeId: employee?.id,
        employeeCode,
        name: employee?.full_name ?? [employee?.first_name, employee?.last_name].filter(Boolean).join(" "),
        email,
        branch: employee?.branch_name ?? employee?.branch_id,
        process: employee?.process_name ?? employee?.process_id,
      },
      lmsRole: roleAccess ?? null,
      trainee: trainee ?? null,
      access: {
        employee: canEmployee,
        coordinator: canCoordinator,
        admin: canAdmin,
      },
    };
  },

  async getNativeEmployeeDashboard(employeeCode: string, email?: string) {
    const [trainee] = await lmsQuery<RowDataPacket[]>(
      `SELECT * FROM trainee_master
        WHERE employee_id = ? OR permanent_emp_id = ? OR email = ?
        LIMIT 1`,
      [employeeCode, employeeCode, email ?? ""],
    );
    if (!trainee) return { trainee: null, modules: [], contents: [], progress: [] };
    const modules = await lmsQuery<RowDataPacket[]>(
      `SELECT m.*, c.classroom_name
         FROM module_master m
         LEFT JOIN classroom_master c ON c.classroom_id = m.classroom_id
        WHERE m.active = 1 AND (? IS NULL OR m.classroom_id = ?)
        ORDER BY m.day_no, m.module_order`,
      [trainee.classroom_id ?? null, trainee.classroom_id ?? null],
    );
    const contents = await lmsQuery<RowDataPacket[]>(
      `SELECT cm.*, mm.module_title, mm.day_no
         FROM content_master cm
         JOIN module_master mm ON mm.module_id = cm.module_id
        WHERE cm.active = 1 AND mm.active = 1 AND (? IS NULL OR mm.classroom_id = ?)
        ORDER BY mm.day_no, mm.module_order, cm.content_order`,
      [trainee.classroom_id ?? null, trainee.classroom_id ?? null],
    );
    const progress = await lmsQuery<RowDataPacket[]>(
      `SELECT * FROM trainee_content_progress
        WHERE employee_id = ? OR trainee_employee_id = ?
        ORDER BY updated_at DESC
        LIMIT 500`,
      [employeeCode, employeeCode],
    ).catch(() => [] as RowDataPacket[]);
    return { trainee, modules, contents, progress };
  },

  async getNativeCoordinatorDashboard(access: any) {
    const role = access?.lmsRole ?? {};
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (!access?.access?.admin) {
      if (role.branch) { conds.push("branch = ?"); params.push(role.branch); }
      if (role.process) { conds.push("process = ?"); params.push(role.process); }
      if (role.lob) { conds.push("lob = ?"); params.push(role.lob); }
    }
    const where = conds.join(" AND ");
    const batches = await lmsQuery<RowDataPacket[]>(`SELECT * FROM batch_master WHERE ${where} ORDER BY start_date DESC, created_at DESC LIMIT 100`, params);
    const trainees = await lmsQuery<RowDataPacket[]>(`SELECT * FROM trainee_master WHERE ${where} ORDER BY last_updated_at DESC LIMIT 200`, params);
    const attendance = await lmsQuery<RowDataPacket[]>(`SELECT * FROM attendance_inference WHERE ${where} ORDER BY attendance_date DESC LIMIT 200`, params).catch(() => [] as RowDataPacket[]);
    return { scope: { branch: role.branch, process: role.process, lob: role.lob }, batches, trainees, attendance };
  },

  async getNativeAdminDashboard() {
    const [batchStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS total_batches, SUM(batch_status = 'Active') AS active_batches FROM batch_master`);
    const [traineeStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS total_trainees, SUM(status = 'Active') AS active_trainees, SUM(certification_status = 'Certified') AS certified FROM trainee_master`);
    const [contentStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS classrooms FROM classroom_master WHERE active = 1`);
    const [moduleStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS modules FROM module_master WHERE active = 1`);
    const [fileStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS contents FROM content_master WHERE active = 1`);
    const roleAccess = await lmsQuery<RowDataPacket[]>(`SELECT login_id, name, role, portal_access, employee_code, branch, process, active FROM role_access_matrix ORDER BY updated_at DESC LIMIT 200`);
    const batches = await lmsQuery<RowDataPacket[]>(`SELECT * FROM batch_master ORDER BY created_at DESC LIMIT 50`);
    return { batchStats, traineeStats, contentStats, moduleStats, fileStats, roleAccess, batches };
  },

  async getNativeBatchPlanner() {
    const [batchRows] = await lmsQuery<RowDataPacket[]>(`
      SELECT
        b.batch_no,
        b.batch_name,
        b.batch_type,
        b.branch,
        b.process,
        b.lob,
        b.classroom_id,
        b.classroom_name,
        b.batch_status,
        b.start_date,
        b.end_date,
        b.expected_trainees,
        b.total_trainees,
        b.ojt_ready,
        b.certified,
        b.handover_to_ops,
        b.created_at,
        b.last_updated_at
      FROM batch_master b
      ORDER BY COALESCE(b.start_date, b.created_at) DESC, b.created_at DESC
      LIMIT 100
    `);

    const batchNos = (batchRows as any[]).map((row) => String(row.batch_no ?? "").trim()).filter(Boolean);
    const traineeCountsRows = batchNos.length
      ? await lmsQuery<RowDataPacket[]>(`
          SELECT
            t.batch_no,
            COUNT(*) AS trainee_count,
            SUM(CASE WHEN LOWER(COALESCE(t.onboarding_status, '')) IN ('joined', 'confirmed') OR LOWER(COALESCE(t.status, '')) = 'active' THEN 1 ELSE 0 END) AS confirmed_onboarded_count,
            SUM(CASE WHEN t.lms_id IS NOT NULL AND t.lms_id <> '' THEN 1 ELSE 0 END) AS lms_ready_count,
            SUM(CASE WHEN t.ojt_ready = 1 THEN 1 ELSE 0 END) AS ojt_ready_count,
            SUM(CASE WHEN t.handover_to_ops = 1 THEN 1 ELSE 0 END) AS handover_to_ops_count,
            SUM(CASE WHEN LOWER(COALESCE(t.certification_status, '')) IN ('certified', 'handedover') THEN 1 ELSE 0 END) AS certified_count
          FROM trainee_master t
          WHERE t.batch_no IN (${buildInClause(batchNos).clause})
          GROUP BY t.batch_no
        `, buildInClause(batchNos).params)
      : [];

    const traineeCounts = new Map<string, any>();
    for (const row of traineeCountsRows as any[]) {
      traineeCounts.set(normalizeLookup(row.batch_no), row);
    }

    const [candidateRows] = await db.execute<RowDataPacket[]>(`
      SELECT
        c.id AS candidate_id,
        c.candidate_code,
        c.full_name,
        c.current_stage,
        c.profile_status,
        c.created_at,
        c.updated_at,
        c.applied_for_branch,
        c.applied_for_process,
        c.applied_for_role,
        c.employee_code AS candidate_employee_code,
        COALESCE(e.employee_code, c.employee_code) AS hrms_employee_code,
        e.id AS hrms_employee_id,
        e.full_name AS employee_name,
        e.official_email,
        e.mobile,
        e.active_status,
        ob.status AS onboarding_bridge_status,
        ob.employee_id AS bridge_employee_id,
        ob.hr_approved_at,
        COALESCE(b.branch_name, c.branch_display_name, c.branch_text, c.applied_for_branch) AS branch_name,
        COALESCE(p.process_name, c.applied_for_process) AS process_name,
        lem.lms_learner_id,
        lem.is_active AS mapping_active
      FROM ats_candidate c
      LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
      LEFT JOIN employees e ON e.id = ob.employee_id
      LEFT JOIN branch_master b ON b.id = c.applied_for_branch OR b.branch_name = c.applied_for_branch OR b.branch_code = c.applied_for_branch
      LEFT JOIN process_master p ON p.id = c.applied_for_process OR p.process_name = c.applied_for_process
      LEFT JOIN lms_employee_mapping lem ON lem.employee_id = e.id AND lem.is_active = 1
      WHERE c.active_status = 1
        AND (
          LOWER(COALESCE(c.current_stage, '')) IN ('selected', 'bgv_pending', 'bgv_verified', 'payroll_validated', 'offer_pending', 'offer_accepted', 'joined', 'converted')
          OR LOWER(COALESCE(c.profile_status, '')) IN ('onboarding_sent', 'profile_submitted', 'onboarded')
          OR LOWER(COALESCE(ob.status, '')) IN ('pending', 'in_progress', 'approved', 'joined')
          OR e.id IS NOT NULL
        )
      ORDER BY c.updated_at DESC, c.created_at DESC
      LIMIT 250
    `);

    const employeeCodes = uniqueNonEmpty([
      ...(candidateRows as any[]).map((row) => row.hrms_employee_code),
      ...(candidateRows as any[]).map((row) => row.candidate_employee_code),
    ]);
    const learnerIds = uniqueNonEmpty((candidateRows as any[]).map((row) => row.lms_learner_id));
    const lmsWhereParts: string[] = [];
    const lmsParams: string[] = [];

    if (employeeCodes.length) {
      const inClause = buildInClause(employeeCodes);
      lmsWhereParts.push(`employee_id IN (${inClause.clause})`, `permanent_emp_id IN (${inClause.clause})`);
      lmsParams.push(...inClause.params, ...inClause.params);
    }
    if (learnerIds.length) {
      const inClause = buildInClause(learnerIds);
      lmsWhereParts.push(`lms_id IN (${inClause.clause})`);
      lmsParams.push(...inClause.params);
    }

    const traineeRows = lmsWhereParts.length
      ? await lmsQuery<RowDataPacket[]>(`
          SELECT
            employee_id,
            permanent_emp_id,
            lms_id,
            trainee_name,
            batch_no,
            branch,
            process,
            lob,
            status,
            onboarding_status,
            course_completion_pct,
            attendance_pct,
            certification_status,
            ojt_ready,
            handover_to_ops,
            risk_status,
            last_updated_at
          FROM trainee_master
          WHERE ${lmsWhereParts.join(" OR ")}
          ORDER BY last_updated_at DESC
        `, lmsParams)
      : [];

    const traineeLookup = new Map<string, any>();
    for (const row of traineeRows as any[]) {
      for (const key of [row.employee_id, row.permanent_emp_id, row.lms_id]) {
        const normalized = normalizeLookup(key);
        if (normalized) traineeLookup.set(normalized, row);
      }
    }

    const batches = (batchRows as any[]).map((row) => {
      const stats = traineeCounts.get(normalizeLookup(row.batch_no)) ?? {};
      const expected = asNumber(row.expected_trainees);
      const total = asNumber(row.total_trainees);
      const traineeCount = asNumber(stats.trainee_count);
      const confirmedOnboardedCount = asNumber(stats.confirmed_onboarded_count);
      const lmsReadyCount = asNumber(stats.lms_ready_count);
      const ojtReadyCount = asNumber(stats.ojt_ready_count);
      const handoverToOpsCount = asNumber(stats.handover_to_ops_count);
      const certifiedCount = asNumber(stats.certified_count);
      const fillPct = expected > 0 ? Math.min(100, (total / expected) * 100) : 0;
      const remainingSlots = Math.max(expected - total, 0);
      const overbooked = Math.max(total - expected, 0);

      return {
        batch_no: row.batch_no,
        batch_name: row.batch_name,
        batch_type: row.batch_type,
        branch: row.branch,
        process: row.process,
        lob: row.lob,
        classroom_id: row.classroom_id,
        classroom_name: row.classroom_name,
        batch_status: row.batch_status,
        start_date: row.start_date,
        end_date: row.end_date,
        expected_trainees: expected,
        total_trainees: total,
        trainee_count: traineeCount,
        confirmed_onboarded_count: confirmedOnboardedCount,
        lms_ready_count: lmsReadyCount,
        ojt_ready_count: ojtReadyCount,
        handover_to_ops_count: handoverToOpsCount,
        certified_count: certifiedCount,
        fill_pct: Number(fillPct.toFixed(1)),
        remaining_slots: remainingSlots,
        overbooked,
        fill_state: overbooked > 0 ? "overbooked" : fillPct >= 100 ? "filled" : fillPct >= 80 ? "nearly_full" : "filling",
        created_at: row.created_at,
        last_updated_at: row.last_updated_at,
      };
    });

    const activeBatches = batches.filter((batch) => normalizeLookup(batch.batch_status) === "active" || normalizeLookup(batch.batch_status) === "planned");
    const selectedCandidates = (candidateRows as any[]).filter((candidate) =>
      ["selected", "bgv_pending", "bgv_verified", "payroll_validated", "offer_pending", "offer_accepted"].includes(normalizeLookup(candidate.current_stage)),
    );

    const plannerCandidates = (candidateRows as any[]).map((candidate) => {
      const trainee = traineeLookup.get(normalizeLookup(candidate.hrms_employee_code))
        ?? traineeLookup.get(normalizeLookup(candidate.candidate_employee_code))
        ?? traineeLookup.get(normalizeLookup(candidate.lms_learner_id))
        ?? null;

      const confirmedOnboarded = Boolean(
        trainee ||
        ["joined", "converted", "onboarded"].includes(normalizeLookup(candidate.current_stage)) ||
        ["onboarded", "profile_submitted"].includes(normalizeLookup(candidate.profile_status)) ||
        ["joined", "approved"].includes(normalizeLookup(candidate.onboarding_bridge_status)),
      );

      const lmsProvisioned = Boolean(
        candidate.lms_learner_id ||
        trainee?.lms_id ||
        trainee?.batch_no ||
        trainee?.status,
      );

      const batchAssigned = Boolean(trainee?.batch_no);
      const readyForTraining = confirmedOnboarded && lmsProvisioned && batchAssigned;

      const suggestedBatch = batchAssigned
        ? trainee.batch_no
        : activeBatches.find((batch) => {
            const branchMatch = candidate.branch_name && batch.branch && normalizeLookup(candidate.branch_name) === normalizeLookup(batch.branch);
            const processMatch = candidate.process_name && batch.process && normalizeLookup(candidate.process_name) === normalizeLookup(batch.process);
            const lobMatch = candidate.applied_for_role && batch.lob && normalizeLookup(candidate.applied_for_role) === normalizeLookup(batch.lob);
            return batch.remaining_slots > 0 && (branchMatch || processMatch || lobMatch);
          })?.batch_no ?? activeBatches.find((batch) => batch.remaining_slots > 0)?.batch_no ?? null;

      const readinessState = readyForTraining
        ? "ready_for_training"
        : batchAssigned
          ? "batch_assigned"
          : lmsProvisioned
            ? "lms_ready"
            : confirmedOnboarded
              ? "onboarded"
              : "selected";

      return {
        candidate_id: candidate.candidate_id,
        candidate_code: candidate.candidate_code,
        full_name: candidate.full_name,
        branch_name: candidate.branch_name,
        process_name: candidate.process_name,
        current_stage: candidate.current_stage,
        profile_status: candidate.profile_status,
        employee_code: candidate.hrms_employee_code,
        employee_name: candidate.employee_name,
        employee_id: candidate.hrms_employee_id,
        lms_learner_id: candidate.lms_learner_id ?? trainee?.lms_id ?? null,
        batch_no: trainee?.batch_no ?? null,
        batch_status: trainee?.status ?? null,
        onboarding_status: trainee?.onboarding_status ?? candidate.onboarding_bridge_status ?? null,
        course_completion_pct: trainee?.course_completion_pct ?? null,
        attendance_pct: trainee?.attendance_pct ?? null,
        certification_status: trainee?.certification_status ?? null,
        risk_status: trainee?.risk_status ?? null,
        confirmed_onboarded: confirmedOnboarded,
        lms_provisioned: lmsProvisioned,
        batch_assigned: batchAssigned,
        ready_for_training: readyForTraining,
        readiness_state: readinessState,
        suggested_batch_no: suggestedBatch,
        suggested_batch_reason: batchAssigned
          ? "Already assigned"
          : readyForTraining
            ? "Ready for classroom allocation"
            : confirmedOnboarded
              ? "Onboarded and waiting for LMS assignment"
              : "Still in selection pipeline",
        created_at: candidate.created_at,
        updated_at: candidate.updated_at,
      };
    });

    const summary = {
      total_batches: batches.length,
      active_batches: activeBatches.length,
      selected_candidates: selectedCandidates.length,
      confirmed_onboarded: plannerCandidates.filter((candidate) => candidate.confirmed_onboarded).length,
      lms_provisioned: plannerCandidates.filter((candidate) => candidate.lms_provisioned).length,
      ready_for_training: plannerCandidates.filter((candidate) => candidate.ready_for_training).length,
      batch_assigned: plannerCandidates.filter((candidate) => candidate.batch_assigned).length,
      open_slots: activeBatches.reduce((sum, batch) => sum + asNumber(batch.remaining_slots), 0),
      overbooked: batches.reduce((sum, batch) => sum + asNumber(batch.overbooked), 0),
      average_fill_pct: batches.length
        ? Number((batches.reduce((sum, batch) => sum + asNumber(batch.fill_pct), 0) / batches.length).toFixed(1))
        : 0,
      filling_batches: batches.filter((batch) => batch.remaining_slots > 0).length,
    };

    return {
      summary,
      batches,
      candidates: plannerCandidates,
    };
  },

  async getProgress(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id, lms_learner_id, course_id, course_name, course_name AS content_title, 'course' AS content_type, NULL AS content_url, completion_pct, score, status, last_accessed, synced_at
         FROM lms_learning_progress_snapshot
        WHERE employee_id = ?
        ORDER BY synced_at DESC`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async getCertifications(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_certification_snapshot WHERE employee_id = ? ORDER BY issued_date DESC",
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async listMappings() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.*, e.full_name, e.employee_code
       FROM lms_employee_mapping m
       LEFT JOIN employees e ON e.id = m.employee_id
       WHERE m.is_active = 1
       ORDER BY e.full_name`
    );
    return rows as RowDataPacket[];
  },

  async upsertMapping(employeeId: string, lmsLearnerId: string, email?: string) {
    await db.execute(
      `INSERT INTO lms_employee_mapping (id, employee_id, lms_learner_id, email)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE lms_learner_id = VALUES(lms_learner_id), email = VALUES(email)`,
      [randomUUID(), employeeId, lmsLearnerId, email ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_employee_mapping WHERE employee_id = ? LIMIT 1", [employeeId]
    );
    return (rows as RowDataPacket[])[0];
  },

  async getSyncLog() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_sync_audit_log ORDER BY created_at DESC LIMIT 100"
    );
    return rows as RowDataPacket[];
  },

  async getProgressSummary() {
    // Aggregate progress stats per employee
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id AS employee_id,
         e.employee_code,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
         COUNT(DISTINCT lp.course_id) AS modules_assigned,
         SUM(CASE WHEN lp.status = 'completed' THEN 1 ELSE 0 END) AS modules_completed,
         ROUND(
           (SUM(CASE WHEN lp.status = 'completed' THEN 1 ELSE 0 END) * 100.0) /
           NULLIF(COUNT(DISTINCT lp.course_id), 0),
           0
         ) AS completion_percent,
         COUNT(DISTINCT lc.id) AS certifications_earned,
         MAX(lp.synced_at) AS last_activity
       FROM employees e
       LEFT JOIN lms_employee_mapping lem ON lem.employee_id = e.id AND lem.is_active = 1
       LEFT JOIN lms_learning_progress_snapshot lp ON lp.employee_id = e.id
       LEFT JOIN lms_certification_snapshot lc ON lc.employee_id = e.id
       WHERE e.active_status = 1
       GROUP BY e.id, e.employee_code, e.first_name, e.last_name
       HAVING modules_assigned > 0
       ORDER BY employee_name`
    );
    return rows as RowDataPacket[];
  },
};
