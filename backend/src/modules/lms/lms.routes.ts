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

export { router as lmsRouter };
