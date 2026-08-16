import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import { getLmsPool, lmsService } from "./lms.service.js";
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

type LmsPortal = "trainee" | "coordinator" | "admin";
type LmsSessionUserType = LmsPortal | "management";

const LMS_SESSION_ROUTES: Record<LmsSessionUserType, { route: string; storageKey: string }> = {
  trainee: { route: "/lms", storageKey: "lms_token_trainee" },
  coordinator: { route: "/coordinator", storageKey: "lms_token_coordinator" },
  admin: { route: "/admin", storageKey: "lms_token_admin" },
  management: { route: "/management", storageKey: "lms_token_management" },
};

/**
 * The user_type values the LMS's own CHECK constraint accepts on portal_sessions
 * (chk_portal_session_user_type). Deliberately narrower than LMS_SESSION_ROUTES, which
 * carries a 'management' persona the LMS schema does not recognise.
 */
const LMS_PORTAL_SESSION_USER_TYPES: readonly string[] = ["trainee", "coordinator", "admin"];

/**
 * The portal names on the wire ("trainee") do not match the keys the service
 * builds its access object with ("employee" — see lmsService access:{} in
 * lms.service.ts). Indexing the access object by portal name therefore yielded
 * `undefined` for trainee and 403'd every user of /lms/my-learning regardless
 * of role or LMS enrolment. Map explicitly rather than renaming the service
 * key: /native/employee below reads `.employee` directly.
 */
const PORTAL_ACCESS_KEY: Record<LmsPortal, "employee" | "coordinator" | "admin"> = {
  trainee: "employee",
  coordinator: "coordinator",
  admin: "admin",
};

function isLmsPortal(value: unknown): value is LmsPortal {
  return value === "trainee" || value === "coordinator" || value === "admin";
}

function joinBaseUrl(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${route}`;
}

function attachLmsSessionParams(url: string, lmsToken: string, lmsUserType: string): string {
  const next = new URL(url);
  next.searchParams.set("hrms_lms_token", lmsToken);
  next.searchParams.set("lms_user_type", lmsUserType);
  return next.toString();
}

/**
 * Refuse a launch rather than hand the caller somebody else's LMS identity.
 *
 * The coordinator and trainee resolvers used to fall back to "the first active row" when
 * the signed-in user matched nothing — ORDER BY created_at ASC LIMIT 1. An unmapped HRMS
 * user was therefore minted a session as the OLDEST active coordinator or trainee: their
 * courses, their progress, their completions, under that person's LMS identity. The
 * secondary `?? employeeCode ?? email` fallback was the same mistake in a quieter form,
 * minting a session for an LMS id that was never verified to exist.
 *
 * There is no safe default here. An identity resolver that cannot identify someone must
 * stop, not guess.
 */
function lmsIdentityNotMapped(portal: LmsPortal): Error & { statusCode: number; code: string } {
  // The admin mapping is held HRMS-side, so pointing an administrator at the LMS to fix it would
  // send them to the wrong system.
  const remedy =
    portal === "admin"
      ? `Ask the LMS administrator to record your own LMS admin account against your employee code ` +
        `in HRMS (lms_admin_identity_map), so your actions in the LMS are recorded as yours.`
      : `Ask HR or the LMS administrator to map your employee code in the LMS before launching it.`;

  const err = new Error(
    `Your HRMS account is not linked to an LMS ${portal} profile yet. ${remedy}`,
  ) as Error & { statusCode: number; code: string };
  err.statusCode = 409;
  err.code = "LMS_IDENTITY_NOT_MAPPED";
  return err;
}

async function resolveDirectLmsIdentity(
  portal: LmsPortal,
  ctx: NonNullable<Awaited<ReturnType<typeof currentLmsContext>>>,
): Promise<{ userId: string; userType: LmsSessionUserType }> {
  const pool = await getLmsPool();
  const employeeCode = String(ctx.access.employeeCode ?? "").trim();
  const email = String(ctx.access.user.email ?? "").trim();

  if (portal === "admin") {
    // The admin portal used to be resolved with
    //   ORDER BY CASE WHEN admin_id = 'LMS-ADMIN' THEN 0 ELSE 1 END, created_at ASC LIMIT 1
    // which is not a resolver at all: whenever the shared 'LMS-ADMIN' account is active it is
    // returned unconditionally, so every HRMS admin who launched the LMS acted as one identity.
    // The LMS's audit_log, login_session_log and content history then attribute every
    // administrative change to "LMS Admin", and nothing can say who made it. Verified read-only
    // 2026-08-16: four real named administrators are active in the LMS and none was ever selected.
    //
    // Mapping is held HRMS-side (lms_admin_identity_map) because admin_user_master carries no
    // employee_code or email to join on and the LMS is a protected system we do not alter.
    if (!employeeCode) throw lmsIdentityNotMapped("admin");

    const [mapRows] = await db.execute<RowDataPacket[]>(
      `SELECT lms_admin_id
         FROM lms_admin_identity_map
        WHERE active = 1 AND hrms_employee_code = ?
        LIMIT 1`,
      [employeeCode],
    );
    const mappedAdminId = String(mapRows[0]?.lms_admin_id ?? "").trim();
    if (!mappedAdminId) throw lmsIdentityNotMapped("admin");

    // Re-checked against the LMS every launch. The mapping table is HRMS-side and the LMS
    // deactivates its own accounts, so a row here must never be sufficient on its own to mint a
    // session for an account the LMS has since switched off.
    const [adminRows] = await pool.execute<RowDataPacket[]>(
      `SELECT admin_id
         FROM admin_user_master
        WHERE active = 1 AND admin_id = ?
        LIMIT 1`,
      [mappedAdminId],
    );
    if (!adminRows[0]?.admin_id) throw lmsIdentityNotMapped("admin");

    return { userId: String(adminRows[0].admin_id), userType: "admin" };
  }

  if (portal === "coordinator") {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT login_id
         FROM role_access_matrix
        WHERE active = 1
          AND (login_id = ? OR login_id = ?)
        LIMIT 1`,
      [employeeCode, email]
    );
    if (rows[0]?.login_id) {
      return { userId: String(rows[0].login_id), userType: "coordinator" };
    }
    throw lmsIdentityNotMapped("coordinator");
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT employee_id
       FROM user_master
      WHERE active = 1
        AND (employee_id = ? OR email = ?)
      LIMIT 1`,
    [employeeCode, email]
  );
  if (rows[0]?.employee_id) {
    return { userId: String(rows[0].employee_id), userType: "trainee" };
  }
  throw lmsIdentityNotMapped("trainee");
}

async function buildLmsSession(
  req: AuthenticatedRequest,
  ctx: NonNullable<Awaited<ReturnType<typeof currentLmsContext>>>,
  portal: LmsPortal,
) {
  const lmsApiUrl = env.LMS_API_URL;

  if (!lmsApiUrl) {
    const err = new Error("LMS_API_URL not configured on HRMS2 backend") as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  const identity = await resolveDirectLmsIdentity(portal, ctx);
  const persona = LMS_SESSION_ROUTES[identity.userType];
  const lmsToken = randomUUID();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const pool = await getLmsPool();

  // portal_sessions lives in the LMS's own database (lms_mcn), which is on a separate
  // release cycle. Its 20260729100000_secure_browser_sessions migration added
  // session_family_id and absolute_expires_at as NOT NULL with no default, and this INSERT
  // supplied neither — so every launch failed with
  // "Field 'session_family_id' doesn't have a default value".
  //
  // It went unnoticed for three days because a separate bug was returning 403 before
  // execution ever reached here. Once that was fixed the crash surfaced immediately.
  //
  // Both values follow the LMS's own backfill convention (migration lines 41 and 44):
  // session_family_id = id for a new family, absolute_expires_at = expires_at. The latter
  // also satisfies their CHECK (absolute_expires_at >= expires_at, line 54).
  //
  // The LMS also constrains user_type to ('trainee','coordinator','admin') — note that
  // LMS_SESSION_ROUTES carries a fourth 'management' persona that would violate it. No
  // resolver path returns it today, but fail with a readable message rather than a raw
  // constraint violation if one ever does.
  if (!LMS_PORTAL_SESSION_USER_TYPES.includes(identity.userType)) {
    throw new Error(`LMS does not accept a portal session for user type "${identity.userType}"`);
  }

  await pool.execute(
    `INSERT INTO portal_sessions
       (id, session_family_id, token, user_id, user_type, expires_at, absolute_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [sessionId, sessionId, lmsToken, identity.userId, identity.userType, expiresAt, expiresAt]
  );

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'sso_session', 1, 0, 'success', ?)`,
    [randomUUID(), req.authUser!.id]
  );

  return {
    lmsToken,
    lmsUserType: identity.userType,
    lmsUserId: identity.userId,
    route: persona.route,
    storageKey: persona.storageKey,
    launchUrl: joinBaseUrl(lmsApiUrl, persona.route),
    bridgeError: null as string | null,
  };
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
    // Same disclosure defect as /launch-context: _details carried the raw driver text.
    res.status(500).json({ success: false, error: "LMS dashboard unavailable" });
  }
}));

router.get("/batch-planner", requireRole("admin", "hr", "super_admin", "operations_head", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const data = await lmsService.getNativeBatchPlanner();
  res.json({ success: true, data });
}));

router.get("/launch-context", h(async (req: AuthenticatedRequest, res: Response) => {
  const portal = isLmsPortal(req.query.portal) ? req.query.portal : "trainee";
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;

  if (!env.LMS_API_URL) {
    return res.status(503).json({ success: false, message: "LMS_API_URL not configured on HRMS backend" });
  }

  if (!ctx.access.access[PORTAL_ACCESS_KEY[portal]]) {
    return res.status(403).json({ success: false, message: `LMS access is not assigned for the ${portal} portal` });
  }

  const portalUrl = joinBaseUrl(env.LMS_API_URL, LMS_SESSION_ROUTES[portal].route);

  try {
    const session = await buildLmsSession(req, ctx, portal);
    const embedUrl = attachLmsSessionParams(portalUrl, session.lmsToken, session.lmsUserType);
    res.json({
      success: true,
      data: {
        portal: portal,
        portal_url: portalUrl,
        embed_url: embedUrl,
        lms_token: session.lmsToken,
        lms_user_type: session.lmsUserType,
        bridge_error: session.bridgeError,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "LMS launch unavailable";
    console.error("[lms/launch-context] direct LMS session mint failed:", message);

    // One curated exception to the generic 502 below: an unmapped identity is not an
    // outage, it is a data gap only HR or the LMS admin can close, and the caller can do
    // nothing with "LMS launch unavailable". This message is authored here (it names no
    // table, column or internal detail), so it does not reopen the leak the comment below
    // describes.
    if ((err as { code?: string })?.code === "LMS_IDENTITY_NOT_MAPPED") {
      return res.status((err as { statusCode?: number }).statusCode ?? 409).json({
        success: false,
        code: "LMS_IDENTITY_NOT_MAPPED",
        message,
      });
    }
    // `error` is deliberately not returned. hrmsApi.ts prefers payload.error over
    // payload.message, so anything put here is what the user reads — which is how
    // "Field 'session_family_id' doesn't have a default value" reached the CEO's screen.
    // The detail is logged above; the browser gets the curated message only.
    res.status(502).json({
      success: false,
      message: "LMS launch unavailable",
    });
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
  `).catch(() => [[] as RowDataPacket[], []] as const);

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
  `).catch(() => [[] as RowDataPacket[], []] as const);

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
//
// This route mints an LMS **admin** session — the portal argument below is hardcoded — and
// its only guard was the router-level requireAuth. Every other native route here checks the
// capability it is about to hand out (`/native/employee` gates on ctx.access.access.employee,
// `/native/coordinator` on .coordinator, and both 403 without it); this one checked nothing.
// So any of the 1,327 active employees could call it and be issued an LMS administrator
// session, with buildLmsSession writing a user_type='admin' row into the LMS's own
// portal_sessions table and returning the token and /admin launch URL to the browser.
//
// The shipped UI path happened to be narrower — the page it sits behind has no page_catalog
// row, so only super_admin reaches it through the app — but a page gate is a client-side
// convenience, not the authorization boundary. 48 sessions have been minted by 8 users.
//
// Gated on the same computed capability its siblings use, rather than a fresh role list, so
// there is one definition of "may act as LMS admin" instead of two that can drift.
router.get("/sso-session", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;
  if (!ctx.access.access.admin) {
    return res.status(403).json({ success: false, message: "LMS administrator access is not assigned to this HRMS user" });
  }
  try {
    const session = await buildLmsSession(req, ctx, "admin");
    res.json({ success: true, ...session });
  } catch (e: any) {
    console.error("[lms/sso-session] bridge error:", e?.message);
    if (e?.statusCode === 503) {
      return res.status(503).json({ success: false, message: e.message });
    }
    return res.status(502).json({ success: false, message: "LMS SSO unavailable. Please try again or contact support." });
  }
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
router.get("/learner-progress/:employee_id", h(async (req: any, res: Response) => {
  const userId = req.authUser!.id;
  const isPrivileged = await hasRole(userId, "admin", "hr", "trainer", "operations_head", "ceo", "manager");
  if (!isPrivileged) {
    // Allow employees to access only their own record
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employee_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM lms_learner_progress WHERE employee_id = ? LIMIT 1`,
    [req.params.employee_id]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "No LMS record found" });
  // generatedAt feeds the dashboard Source Freshness panel, which otherwise reads
  // "Timestamp unavailable" (CEO UAT).
  res.json({ success: true, data: rows[0], generatedAt: new Date().toISOString() });
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
