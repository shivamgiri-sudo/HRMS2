import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import { lmsService } from "./lms.service.js";
import { runFullSync } from "./lms.sync.service.js";
import {
  encryptCredentials,
  invalidatePool,
} from "../external-db/external-db.service.js";
import { env } from "../../config/env.js";
import { lmsEmployeeMapper } from "./lms-employee-mapper.js";
import { randomUUID } from "crypto";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

async function currentHrmsRoles(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1", [userId]);
  return rows.map((row: any) => String(row.role_key));
}

async function currentEmployee(userId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.*, b.branch_name, p.process_name, d.dept_name AS department_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master d ON d.id = e.department_id
      WHERE e.user_id = ? AND e.active_status = 1
      ORDER BY e.updated_at DESC
      LIMIT 1`,
    [userId],
  );
  return rows[0] as any | undefined;
}

async function currentLmsContext(req: AuthenticatedRequest, res: Response) {
  const employee = await currentEmployee(req.authUser!.id);
  if (!employee) {
    res.status(403).json({ success: false, message: "No active HRMS employee profile found for LMS mapping" });
    return null;
  }
  const roles = await currentHrmsRoles(req.authUser!.id);
  const access = await lmsService.getAccessForEmployee(employee, roles);
  return { employee, roles, access };
}

async function resolveOwnEmployeeId(req: AuthenticatedRequest, res: Response) {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp?.id) {
    res.status(403).json({ success: false, message: "No employee record" });
    return null;
  }
  return emp.id;
}

// Native HRMS-integrated LMS access. No external link or LMS re-login required.
router.get("/native/access", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;
  res.json({ success: true, data: ctx.access });
}));

router.get("/native/employee", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;
  if (!ctx.access.access.employee) return res.status(403).json({ success: false, message: "LMS employee access is not mapped" });
  const data = await lmsService.getNativeEmployeeDashboard(ctx.access.employeeCode, ctx.access.user.email);
  res.json({ success: true, data: { ...data, access: ctx.access } });
}));

router.get("/native/coordinator", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;
  if (!ctx.access.access.coordinator) return res.status(403).json({ success: false, message: "Coordinator LMS access is not assigned to this HRMS user" });
  res.json({ success: true, data: { ...(await lmsService.getNativeCoordinatorDashboard(ctx.access)), access: ctx.access } });
}));

router.get("/native/admin", h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await currentLmsContext(req, res);
    if (!ctx) return;
    if (!ctx.access.access.admin) return res.status(403).json({ success: false, message: "Admin LMS access is not assigned to this HRMS user" });
    const dashboard = await lmsService.getNativeAdminDashboard();
    res.json({ success: true, data: { ...dashboard, access: ctx.access } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "LMS service error";
    console.error("[lms/native/admin]", msg);
    res.status(500).json({ success: false, error: "LMS dashboard unavailable", _details: msg });
  }
}));

// Legacy aliases retained for existing pages.
router.get("/launch-urls/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = await resolveOwnEmployeeId(req, res);
  if (!employeeId) return;
  res.json({ success: true, data: { learner_url: "/lms/my-learning", coordinator_url: "/lms/coordinator", admin_url: "/lms/integration" } });
}));

router.get("/launch-urls/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  res.json({ success: true, data: { learner_url: "/lms/my-learning", coordinator_url: "/lms/coordinator", admin_url: "/lms/integration" } });
}));

router.get("/progress/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = await resolveOwnEmployeeId(req, res);
  if (!employeeId) return;
  res.json({ success: true, data: await lmsService.getProgress(employeeId) });
}));

router.get("/progress/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  res.json({ success: true, data: await lmsService.getProgress(req.params.employeeId) });
}));

router.get("/certifications/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = await resolveOwnEmployeeId(req, res);
  if (!employeeId) return;
  res.json({ success: true, data: await lmsService.getCertifications(employeeId) });
}));

router.get("/certifications/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  res.json({ success: true, data: await lmsService.getCertifications(req.params.employeeId) });
}));

router.get("/mapping", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.listMappings() });
}));

router.post("/mapping",
  requireRole("admin", "hr", "trainer"),
  requireScopedRole(["hr", "trainer"], async (req) => {
    const [rows] = await db.execute(
      'SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return { branchId: emp?.branch_id, processId: emp?.process_id };
  }),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employee_id, lms_learner_id, email } = req.body;
    if (!employee_id || !lms_learner_id) return res.status(400).json({ error: "employee_id and lms_learner_id required" });
    res.status(201).json({ success: true, data: await lmsService.upsertMapping(employee_id, lms_learner_id, email) });
  })
);

router.post("/mapping/auto-map",
  requireRole("admin", "hr", "trainer"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { lms_learner_id } = req.body;
    if (!lms_learner_id) return res.status(400).json({ error: "lms_learner_id required" });
    const result = await lmsEmployeeMapper.mapLmsTrainee(String(lms_learner_id));
    res.json({ success: result.success, data: result });
  })
);

router.get("/mapping/audit",
  requireRole("admin", "hr", "trainer"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM lms_mapping_audit ORDER BY attempted_at DESC LIMIT 100`
    );
    res.json({ success: true, data: rows });
  })
);

router.get("/sync-log", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.getSyncLog() });
}));

// ── LMS connection test ────────────────────────────────────────────────────────
router.get("/connection", requireRole("admin", "hr", "super_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const result = await lmsService.testConnection();
  res.json({ success: true, data: result });
}));

// ── Manual full sync ───────────────────────────────────────────────────────────
router.post("/sync", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const actorId = req.authUser!.id;
  const result = await runFullSync(actorId);
  res.json({ success: true, data: result });
}));

// ── Sync status (last 5 audit rows) ───────────────────────────────────────────
router.get("/sync/status", requireRole("admin", "hr", "super_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const connection = await lmsService.testConnection();
  const [rows] = await db.execute(
    "SELECT * FROM lms_sync_audit_log ORDER BY created_at DESC LIMIT 5"
  );
  res.json({ success: true, data: { connection, recent_syncs: rows } });
}));

// GET /api/lms/progress-summary
router.get("/progress-summary", requireRole("admin", "hr", "super_admin", "operations_head", "branch_head"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [summaryRows] = await db.execute<RowDataPacket[]>(`
    SELECT
      COUNT(DISTINCT m.employee_id) AS totalLearners,
      COUNT(DISTINCT CASE WHEN m.is_active = 1 THEN m.employee_id END) AS mappedLearners,
      COALESCE(ROUND(AVG(p.completion_pct), 1), 0) AS averageCourseCompletion,
      COALESCE(ROUND(AVG(p.score), 1), 0) AS averageAssessmentPass,
      COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.employee_id END) AS certifiedCount,
      MAX(p.synced_at) AS lastSyncAt
    FROM lms_employee_mapping m
    LEFT JOIN lms_learning_progress_snapshot p ON p.employee_id = m.employee_id
    LEFT JOIN lms_certification_snapshot c ON c.employee_id = m.employee_id
  `);
  const summary = (summaryRows as any[])[0] ?? {};

  const [atRiskRows] = await db.execute<RowDataPacket[]>(`
    SELECT lp.employee_id, lp.employee_code, e.full_name AS employee_name,
           lp.readiness_score, lp.attrition_risk_signal, lp.batch_no, lp.synced_at
    FROM lms_learner_progress lp
    LEFT JOIN employees e ON e.id = lp.employee_id
    WHERE lp.attrition_risk_signal = 'red'
    ORDER BY lp.readiness_score ASC
    LIMIT 20
  `).catch(() => [] as RowDataPacket[]);

  const [byBatchRows] = await db.execute<RowDataPacket[]>(`
    SELECT lp.batch_no,
           COUNT(DISTINCT lp.employee_id) AS total_learners,
           ROUND(AVG(lp.readiness_score), 1) AS avg_readiness,
           SUM(CASE WHEN lp.ops_handover_ready = 1 THEN 1 ELSE 0 END) AS ready_count,
           SUM(CASE WHEN lp.attrition_risk_signal = 'red' THEN 1 ELSE 0 END) AS at_risk_count
    FROM lms_learner_progress lp
    WHERE lp.batch_no IS NOT NULL
    GROUP BY lp.batch_no
    ORDER BY lp.batch_no DESC
    LIMIT 20
  `).catch(() => [] as RowDataPacket[]);

  const [perEmpRows] = await db.execute<RowDataPacket[]>(`
    SELECT
      e.id AS employee_id,
      e.employee_code,
      e.full_name AS employee_name,
      COUNT(DISTINCT p.course_id) AS modules_assigned,
      COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN p.course_id END) AS modules_completed,
      COALESCE(ROUND(AVG(p.completion_pct), 0), 0) AS completion_percent,
      COUNT(DISTINCT c.id) AS certifications_earned,
      MAX(p.synced_at) AS last_activity
    FROM employees e
    JOIN lms_employee_mapping m ON m.employee_id = e.id AND m.is_active = 1
    LEFT JOIN lms_learning_progress_snapshot p ON p.employee_id = e.id
    LEFT JOIN lms_certification_snapshot c ON c.employee_id = e.id AND c.status = 'active'
    WHERE e.active_status = 1
    GROUP BY e.id, e.employee_code, e.full_name
    ORDER BY completion_percent DESC
    LIMIT 200
  `);

  const [syncStatusRows] = await db.execute<RowDataPacket[]>(
    `SELECT sync_type, status, records_synced, errors_count, created_at
     FROM lms_sync_audit_log ORDER BY created_at DESC LIMIT 4`
  );

  res.json({
    success: true,
    data: perEmpRows,
    summary: {
      totalLearners: Number(summary.totalLearners ?? 0),
      mappedLearners: Number(summary.mappedLearners ?? 0),
      activeBatches: (byBatchRows as any[]).length,
      averageCourseCompletion: Number(summary.averageCourseCompletion ?? 0),
      averageAssessmentPass: Number(summary.averageAssessmentPass ?? 0),
      averageAttendance: 0,
      certifiedCount: Number(summary.certifiedCount ?? 0),
      ojtReadyCount: 0,
      opsHandoverReadyCount: (byBatchRows as any[]).reduce((s: number, r: any) => s + Number(r.ready_count ?? 0), 0),
      atRiskCount: (atRiskRows as any[]).length,
      lastSyncAt: summary.lastSyncAt ?? null,
    },
    byBatch: byBatchRows,
    atRiskLearners: atRiskRows,
    syncStatus: syncStatusRows,
  });
}));

// GET /api/lms/sso-session
// HRMS2 backend calls LMS /api/auth/bridge with backend-only secret.
router.get("/sso-session", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;

  const lmsApiUrl = env.LMS_API_URL;
  const bridgeSecret = env.LMS_BRIDGE_SECRET;

  if (!lmsApiUrl) {
    return res.status(503).json({ success: false, message: "LMS_API_URL not configured on HRMS2 backend" });
  }

  const employeeCode = ctx.access.employeeCode;
  const email = ctx.access.user.email;

  const body: Record<string, string> = {};
  if (employeeCode) body.employee_id = employeeCode;
  if (email) body.email = email;
  if (bridgeSecret) body.bridge_token = bridgeSecret;

  let bridgeRes: any;
  try {
    const fetchRes = await fetch(`${lmsApiUrl}/api/auth/bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    bridgeRes = await fetchRes.json();
    if (!fetchRes.ok || !bridgeRes.ok) {
      throw new Error(bridgeRes.message || `Bridge responded ${fetchRes.status}`);
    }
  } catch (e: any) {
    console.error("[lms/sso-session] bridge error:", e?.message);
    return res.status(502).json({ success: false, message: "LMS SSO unavailable. Please try again or contact support." });
  }

  const userType: string = bridgeRes.userType ?? (
    ctx.access.access.admin ? "admin" :
    ctx.access.access.coordinator ? "coordinator" : "trainee"
  );

  const personaMap: Record<string, { route: string; storageKey: string }> = {
    trainee:     { route: "/lms",         storageKey: "lms_token_trainee" },
    coordinator: { route: "/coordinator", storageKey: "lms_token_coordinator" },
    admin:       { route: "/admin",       storageKey: "lms_token_admin" },
    management:  { route: "/management",  storageKey: "lms_token_management" },
  };
  const persona = personaMap[userType] ?? personaMap.trainee;

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'sso_session', 1, 0, 'success', ?)`,
    [randomUUID(), req.authUser!.id]
  );

  return res.json({
    success: true,
    lmsToken: bridgeRes.lms_token,
    lmsUserType: userType,
    lmsUserId: bridgeRes.userId ?? employeeCode,
    route: persona.route,
    storageKey: persona.storageKey,
    launchUrl: `${lmsApiUrl}${persona.route}`,
  });
}));

router.get("/launch-audit",
  requireRole("admin", "hr", "super_admin"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM lms_sync_audit_log WHERE sync_type = 'sso_session' ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ success: true, data: rows });
  })
);

// ── Save Integration Hub LMS credentials ──────────────────────────────────────
// POST /api/lms/config  { host, port, database, username, password, db_type? }
// Encrypts creds, upserts into integration_config (lms_sync key), invalidates pool cache.
router.post("/config", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { host, port, database, username, password, db_type } = req.body;
  if (!host || !database || !username || !password) {
    return res.status(400).json({ success: false, message: "host, database, username, password required" });
  }
  const creds = {
    host: String(host),
    port: Number(port ?? 3306),
    database: String(database),
    username: String(username),
    password: String(password),
    db_type: (db_type === "mssql" ? "mssql" : "mysql") as "mysql" | "mssql",
  };
  const encrypted = encryptCredentials(creds);
  await db.execute(
    `INSERT INTO integration_config (id, integration_key, integration_name, integration_type, vendor_name, config_json, encrypted_credentials, active_status, notes)
     VALUES (UUID(), 'lms_sync', 'MCN LMS Sync', 'database', 'MCN LMS',
       JSON_OBJECT('db_type', ?, 'host', ?, 'port', ?, 'database', ?, 'description', 'Read-only sync from deployed MCN LMS'),
       ?, 1, 'Pulls trainee progress and certifications from lms_mcn into HRMS snapshot tables')
     ON DUPLICATE KEY UPDATE
       encrypted_credentials = VALUES(encrypted_credentials),
       config_json = VALUES(config_json),
       active_status = 1,
       updated_at = NOW()`,
    [creds.db_type, creds.host, creds.port, creds.database, encrypted]
  );
  // Ensure schedule row exists (disabled by default)
  await db.execute(
    `INSERT IGNORE INTO integration_schedule (id, integration_key, cron_expression, enabled)
     VALUES (UUID(), 'lms_sync', '0 */6 * * *', 0)`
  );
  invalidatePool("lms_sync");
  res.json({ success: true, message: "LMS credentials saved. Connection will be tested on next request." });
}));

// ── Get current config (non-sensitive) ────────────────────────────────────────
router.get("/config", requireRole("admin", "hr", "super_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<any[]>(
    `SELECT ic.integration_key, ic.integration_name, ic.active_status, ic.updated_at,
            ic.config_json,
            CASE WHEN ic.encrypted_credentials IS NOT NULL THEN 1 ELSE 0 END AS has_credentials,
            isch.cron_expression, isch.enabled AS schedule_enabled, isch.last_run_at, isch.next_run_at
       FROM integration_config ic
       LEFT JOIN integration_schedule isch ON isch.integration_key = ic.integration_key
      WHERE ic.integration_key = 'lms_sync'
      LIMIT 1`
  );
  const row = (rows as any[])[0] ?? null;
  if (row?.config_json && typeof row.config_json === "string") {
    try { row.config_json = JSON.parse(row.config_json); } catch {}
  }
  // Never return encrypted_credentials — return only non-sensitive config
  res.json({ success: true, data: row });
}));

// Absorbed from lms-dashboard.routes.ts
router.get("/learner-progress/:employee_id", requireRole("admin", "hr", "trainer", "operations_head"), h(async (req: any, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM lms_learner_progress WHERE employee_id = ? LIMIT 1`,
    [req.params.employee_id]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "No LMS record found" });
  res.json({ success: true, data: rows[0] });
}));

router.get("/batch-progress/:batch_no", requireRole("admin", "hr", "trainer", "operations_head"), h(async (req: any, res: Response) => {
  const [summary] = await db.execute<RowDataPacket[]>(`
    SELECT batch_no,
           COUNT(DISTINCT employee_id) AS total_learners,
           AVG(mcq_best_score) AS avg_score,
           AVG(readiness_score) AS avg_readiness,
           SUM(CASE WHEN ops_handover_ready = 1 THEN 1 ELSE 0 END) AS ready_count,
           SUM(CASE WHEN attrition_risk_signal = 'red' THEN 1 ELSE 0 END) AS high_risk_count
    FROM lms_learner_progress WHERE batch_no = ? GROUP BY batch_no
  `, [req.params.batch_no]);
  res.json({ success: true, data: (summary as any[])[0] || {} });
}));

router.get("/assessment-history/:employee_id", h(async (req: any, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employee_id) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT id, employee_id, employee_code, assessment_name, attempt_no,
           score, percentage, result, time_taken_seconds, attempted_at, synced_at
    FROM lms_assessment_scores WHERE employee_id = ? ORDER BY attempted_at DESC LIMIT 50
  `, [req.params.employee_id]);
  res.json({ success: true, data: rows });
}));

export { router as lmsRouter };
