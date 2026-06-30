import { Router } from "express";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import {
  encryptCredentials,
  invalidatePool,
  type DbCredentials,
} from "../external-db/external-db.service.js";
import { SaveDbConfigSchema } from "../external-db/external-db.validation.js";
import { lmsExecute, lmsQuery, lmsService } from "./lms.service.js";
import { runFullSync } from "./lms.sync.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

const LMS_PORTALS = {
  trainee: "lms",
  coordinator: "coordinator",
  admin: "admin",
} as const;

type LmsPortal = keyof typeof LMS_PORTALS;

function portalUrl(portal: LmsPortal): string {
  return `${env.LMS_PORTAL_URL.replace(/\/$/, "")}/${LMS_PORTALS[portal]}`;
}

async function getUserRoles(userId: string): Promise<string[]> {
  const [rows] = await db.execute(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId],
  ) as any[];
  return (rows as Array<{ role_key: string }>).map((row) => String(row.role_key));
}

async function getEmployeeProfileForUser(userId: string) {
  const [rows] = await db.execute(
    `SELECT e.id, e.employee_code, e.user_id, e.first_name, e.last_name,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS email,
            NULLIF(TRIM(COALESCE(e.personal_email, '')), '') AS personal_email,
            e.mobile, e.branch_id, e.process_id
       FROM employees e
      WHERE e.user_id = ?
        AND (e.active_status = 1 OR (e.active_status = 0 AND e.access_end_date >= CURDATE()))
      ORDER BY e.updated_at DESC
      LIMIT 1`,
    [userId],
  ) as any[];
  return rows[0] ?? null;
}

async function assertPortalAccess(req: AuthenticatedRequest, portal: LmsPortal): Promise<void> {
  const userId = req.authUser!.id;
  if (portal === "trainee") return;

  const allowed = portal === "admin"
    ? await hasRole(userId, "admin", "hr", "ceo", "lms_admin")
    : await hasRole(userId, "admin", "hr", "trainer", "quality", "quality_auditor", "qa", "qtl", "lms_coordinator");

  if (!allowed) {
    throw Object.assign(new Error("Access denied for requested LMS portal"), { statusCode: 403 });
  }
}

async function buildLmsBridgeContext(req: AuthenticatedRequest, portal: LmsPortal) {
  await assertPortalAccess(req, portal);

  const employee = await getEmployeeProfileForUser(req.authUser!.id);
  const body: Record<string, string> = {};
  const employeeCode = employee?.employee_code ? String(employee.employee_code).trim() : "";
  const email = String(employee?.email ?? employee?.personal_email ?? req.authUser?.email ?? "").trim();
  const mobile = String(employee?.mobile ?? "").trim();

  if (employeeCode) body.employee_id = employeeCode;
  if (email) body.email = email;
  if (mobile) body.mobile = mobile;
  if (env.LMS_BRIDGE_SECRET) body.bridge_token = env.LMS_BRIDGE_SECRET;

  const targetUrl = portalUrl(portal);
  if (!body.employee_id && !body.email && !body.mobile) {
    return {
      portal,
      portal_url: targetUrl,
      embed_url: targetUrl,
      lms_token: null,
      lms_user_type: null,
      bridge_error: "No HRMS employee code, email or mobile was available for LMS SSO.",
      employee,
    };
  }

  try {
    const response = await fetch(`${env.LMS_PORTAL_URL.replace(/\/$/, "")}/api/auth/bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.ok || !json.lms_token) {
      throw new Error(json.message || `LMS bridge failed (${response.status})`);
    }

    const query = new URLSearchParams({
      hrms_lms_token: String(json.lms_token),
      lms_user_type: String(json.userType ?? portal),
    });

    return {
      portal,
      portal_url: targetUrl,
      embed_url: `${targetUrl}?${query.toString()}`,
      lms_token: json.lms_token,
      lms_user_type: json.userType ?? portal,
      bridge_error: null,
      employee,
    };
  } catch (error) {
    const directSession = await createDirectLmsSession(portal, employee, req.authUser?.email).catch((fallbackError) => ({
      fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    }) as { fallbackError: string });
    if (directSession) {
      if ("fallbackError" in directSession) {
        return {
          portal,
          portal_url: targetUrl,
          embed_url: targetUrl,
          lms_token: null,
          lms_user_type: null,
          bridge_error: [
            error instanceof Error ? error.message : String(error),
            `Direct LMS session fallback failed: ${directSession.fallbackError}`,
          ].join(" | "),
          employee,
        };
      }
      const query = new URLSearchParams({
        hrms_lms_token: directSession.token,
        lms_user_type: directSession.userType,
      });
      return {
        portal,
        portal_url: targetUrl,
        embed_url: `${targetUrl}?${query.toString()}`,
        lms_token: directSession.token,
        lms_user_type: directSession.userType,
        bridge_error: null,
        employee,
        bridge_fallback: "direct_lms_session",
        lms_user_id: directSession.userId,
      };
    }

    return {
      portal,
      portal_url: targetUrl,
      embed_url: targetUrl,
      lms_token: null,
      lms_user_type: null,
      bridge_error: error instanceof Error ? error.message : String(error),
      employee,
    };
  }
}

function compactIdentifier(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueCandidates(employee: any, authEmail?: string): string[] {
  const email = compactIdentifier(employee?.email);
  const auth = compactIdentifier(authEmail);
  const fullName = compactIdentifier(employee?.full_name);
  const candidates = [
    employee?.employee_code,
    email,
    email.includes("@") ? email.split("@")[0] : "",
    auth,
    auth.includes("@") ? auth.split("@")[0] : "",
    employee?.mobile,
    fullName,
    fullName.replace(/[^a-z0-9]/g, ""),
  ].map(compactIdentifier).filter(Boolean);
  return [...new Set(candidates)];
}

async function findByCandidates(
  table: string,
  selectColumn: string,
  whereColumns: string[],
  candidates: string[],
): Promise<string | null> {
  if (candidates.length === 0) return null;
  const placeholders = candidates.map(() => "?").join(",");
  const where = whereColumns
    .map((column) => `LOWER(${column}) IN (${placeholders})`)
    .join(" OR ");
  const params = whereColumns.flatMap(() => candidates);
  const rows = await lmsQuery(
    `SELECT ${selectColumn} AS user_id
       FROM ${table}
      WHERE (${where})
        ${table === "admin_user_master" || table === "role_access_matrix" || table === "user_master" ? "AND active = 1" : ""}
      LIMIT 1`,
    params,
  ).catch(() => [] as any[]);
  return rows[0]?.user_id ? String(rows[0].user_id) : null;
}

async function createDirectLmsSession(
  portal: LmsPortal,
  employee: any,
  authEmail?: string,
): Promise<{ token: string; userType: string; userId: string } | null> {
  const candidates = uniqueCandidates(employee, authEmail);
  let userType: "trainee" | "coordinator" | "admin" = portal === "trainee" ? "trainee" : portal;
  let userId: string | null = null;

  if (portal === "admin") {
    userId = await findByCandidates(
      "admin_user_master",
      "admin_id",
      ["admin_id"],
      candidates,
    );
  } else if (portal === "coordinator") {
    userId = await findByCandidates(
      "role_access_matrix",
      "login_id",
      ["login_id", "employee_code", "email", "mobile"],
      candidates,
    );
  } else {
    userId = await findByCandidates(
      "user_master",
      "employee_id",
      ["employee_id", "email", "mobile"],
      candidates,
    ) ?? await findByCandidates(
      "trainee_master",
      "employee_id",
      ["employee_id", "permanent_emp_id", "lms_id", "email", "mobile"],
      candidates,
    );
  }

  if (!userId) return null;
  const token = `${randomUUID()}-${randomUUID()}`;
  await lmsExecute(
    `INSERT INTO portal_sessions (id, token, user_id, user_type, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 6 HOUR))`,
    [randomUUID(), token, userId, userType],
  );
  return { token, userType, userId };
}

// Exact deployed LMS portal launch context for HRMS iframe/SSO.
router.get("/launch-context", h(async (req: AuthenticatedRequest, res: Response) => {
  const requested = String(req.query.portal ?? "trainee");
  const portal = requested === "admin" || requested === "coordinator" ? requested : "trainee";
  const data = await buildLmsBridgeContext(req, portal);
  res.json({ success: true, data });
}));

// Live LMS DB connection status. Used by the LMS Integration page.
router.get("/connection", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.testConnection() });
}));

// Save LMS DB credentials into the Integration Hub connector (encrypted).
router.post("/config", requireRole("admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const parsed = SaveDbConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors });
  }

  const input = parsed.data;
  const writeUsername = String(req.body?.write_username ?? req.body?.writeUsername ?? "").trim();
  const writePassword = String(req.body?.write_password ?? req.body?.writePassword ?? "");
  const writeHost = String(req.body?.write_host ?? req.body?.writeHost ?? input.host).trim();
  const writeDatabase = String(req.body?.write_database ?? req.body?.writeDatabase ?? input.database).trim();
  const writePort = Number(req.body?.write_port ?? req.body?.writePort ?? input.port) || input.port;
  const creds: DbCredentials = {
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    password: input.password ?? "",
    date_column: input.date_column ?? "last_updated_at",
    employee_code_column: input.employee_code_column ?? "employee_id",
    tables: input.tables?.length ? input.tables : ["trainee_master"],
    db_type: input.db_type,
    encrypt: input.encrypt ?? false,
    trust_server_certificate: input.trust_server_certificate ?? true,
  };

  await db.execute(
    `INSERT INTO integration_config
       (id, integration_key, integration_name, integration_type, vendor_name, config_json,
        encrypted_credentials, active_status, notes)
     VALUES
       (UUID(), 'lms_sync', 'MCN LMS Sync', 'database', 'MCN LMS', ?, ?, 1,
        'Live LMS database connection for HRMS embedded LMS and snapshot sync.')
     ON DUPLICATE KEY UPDATE
       integration_name = VALUES(integration_name),
       integration_type = VALUES(integration_type),
       vendor_name = VALUES(vendor_name),
       config_json = VALUES(config_json),
       encrypted_credentials = VALUES(encrypted_credentials),
       active_status = 1,
       updated_at = NOW()`,
    [
      JSON.stringify({
        connector_kind: "mysql",
        db_type: input.db_type,
        host: input.host,
        port: input.port,
        database: input.database,
        username: input.username,
        source_tables: creds.tables,
        tables: creds.tables,
        date_column: creds.date_column,
        employee_code_column: creds.employee_code_column,
        sync_model: "lms_native",
      }),
      encryptCredentials(creds),
    ],
  );

  if (writeUsername && writePassword) {
    const writeCreds: DbCredentials = {
      host: writeHost || input.host,
      port: writePort,
      database: writeDatabase || input.database,
      username: writeUsername,
      password: writePassword,
      date_column: input.date_column ?? "last_updated_at",
      employee_code_column: input.employee_code_column ?? "employee_id",
      tables: input.tables?.length ? input.tables : ["trainee_master"],
      db_type: input.db_type,
      encrypt: input.encrypt ?? false,
      trust_server_certificate: input.trust_server_certificate ?? true,
    };

    await db.execute(
      `INSERT INTO integration_config
         (id, integration_key, integration_name, integration_type, vendor_name, config_json,
          encrypted_credentials, active_status, notes)
       VALUES
         (UUID(), 'lms_write', 'MCN LMS Write Back', 'database', 'MCN LMS', ?, ?, 1,
          'Write-capable LMS database connection for HRMS-to-LMS mapping updates.')
       ON DUPLICATE KEY UPDATE
         integration_name = VALUES(integration_name),
         integration_type = VALUES(integration_type),
         vendor_name = VALUES(vendor_name),
         config_json = VALUES(config_json),
         encrypted_credentials = VALUES(encrypted_credentials),
         active_status = 1,
         updated_at = NOW()`,
      [
        JSON.stringify({
          connector_kind: "mysql",
          db_type: input.db_type,
          host: writeCreds.host,
          port: writeCreds.port,
          database: writeCreds.database,
          username: writeCreds.username,
          source_tables: writeCreds.tables,
          tables: writeCreds.tables,
          date_column: writeCreds.date_column,
          employee_code_column: writeCreds.employee_code_column,
          sync_model: "lms_write_back",
        }),
        encryptCredentials(writeCreds),
      ],
    );
    invalidatePool("lms_write");
  }

  await db.execute(
    `INSERT INTO integration_schedule (id, integration_key, cron_expression, enabled)
     VALUES (UUID(), 'lms_sync', '5 * * * *', 0)
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
  );

  invalidatePool("lms_sync");
  res.json({ success: true, message: "LMS connection saved in Integration Hub" });
}));

// Manual full LMS snapshot sync into HRMS tables and Integration Hub run history.
router.post("/sync", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const startedAt = Date.now();
  const runId = randomUUID();
  await db.execute(
    `INSERT INTO integration_connector_run
       (id, integration_key, triggered_by, triggered_user, status)
     VALUES (?, 'lms_sync', 'manual', ?, 'running')`,
    [runId, req.authUser!.id],
  );

  try {
    const result = await runFullSync(req.authUser!.id);
    const rowsPromoted = result.mapped + result.progress + result.certifications;
    const status = result.errors.length === 0 ? "complete" : rowsPromoted > 0 ? "complete" : "failed";
    await db.execute(
      `UPDATE integration_connector_run
          SET status = ?, rows_fetched = ?, rows_promoted = ?, rows_failed = ?,
              duration_ms = ?, error_message = ?, completed_at = NOW()
        WHERE id = ?`,
      [
        status,
        rowsPromoted,
        rowsPromoted,
        result.errors.length,
        Date.now() - startedAt,
        result.errors.length ? result.errors.slice(0, 10).join("; ") : null,
        runId,
      ],
    );
    res.status(status === "failed" ? 502 : 200).json({ success: status !== "failed", data: { ...result, run_id: runId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.execute(
      `UPDATE integration_connector_run
          SET status = 'failed', rows_failed = 1, duration_ms = ?,
              error_message = ?, completed_at = NOW()
        WHERE id = ?`,
      [Date.now() - startedAt, message, runId],
    );
    throw error;
  }
}));

router.get("/native/employee", h(async (req: AuthenticatedRequest, res: Response) => {
  const employee = await getEmployeeProfileForUser(req.authUser!.id);
  if (!employee) return res.status(404).json({ success: false, message: "Employee record not found for this user" });
  res.json({ success: true, data: await lmsService.getNativeEmployeeDashboard(employee.employee_code, employee.email) });
}));

router.get("/native/coordinator", h(async (req: AuthenticatedRequest, res: Response) => {
  await assertPortalAccess(req, "coordinator");
  const employee = await getEmployeeProfileForUser(req.authUser!.id);
  const roles = await getUserRoles(req.authUser!.id);
  const access = employee
    ? await lmsService.getAccessForEmployee(employee, roles)
    : { access: { admin: await hasRole(req.authUser!.id, "admin", "hr") }, lmsRole: null };
  res.json({ success: true, data: await lmsService.getNativeCoordinatorDashboard(access) });
}));

router.get("/native/admin", requireRole("admin", "hr", "ceo", "lms_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.getNativeAdminDashboard() });
}));

// Get LMS deep-link URLs for authenticated employee (own) or admin/hr for any employee
router.get("/launch-urls/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  res.json({ success: true, data: {
    learner_url: "https://mcnlms.teammas.in/lms",
    coordinator_url: "https://mcnlms.teammas.in/coordinator",
    admin_url: "https://mcnlms.teammas.in/admin",
  }});
}));

// Get progress summary for all employees (admin/hr/trainer)
router.get("/progress-summary", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.getProgressSummary() });
}));

// Get current user's LMS progress (convenience endpoint)
router.get("/progress/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const emp = await getEmployeeForUser(userId);
  if (!emp) {
    return res.status(404).json({ success: false, message: "Employee record not found for this user" });
  }
  res.json({ success: true, data: await lmsService.getProgress(emp.id) });
}));

// Get employee's LMS progress snapshot
router.get("/progress/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  res.json({ success: true, data: await lmsService.getProgress(req.params.employeeId) });
}));

// Get certifications for employee
router.get("/certifications/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  res.json({ success: true, data: await lmsService.getCertifications(req.params.employeeId) });
}));

// Get/update employee-to-LMS learner mapping (admin/hr/trainer)
router.get("/mapping", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.listMappings() });
}));

router.post("/mapping",
  requireRole("admin", "hr", "trainer"),
  requireScopedRole(["hr", "trainer"], async (req) => {
    // Trainer scoped by branch/process
    const [rows] = await db.execute(
      'SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id
    };
  }),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employee_id, lms_learner_id, email } = req.body;
    if (!employee_id || !lms_learner_id) {
      return res.status(400).json({ error: "employee_id and lms_learner_id required" });
    }
    res.status(201).json({ success: true, data: await lmsService.upsertMapping(employee_id, lms_learner_id, email) });
  })
);

// Sync audit log
router.get("/sync-log", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.getSyncLog() });
}));

export { router as lmsRouter };
