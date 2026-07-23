import { Router } from "express";
import { pingDb } from "../db/mysql.js";
import { getMigrationHealth, getSchemaVerificationState, isSchemaReady } from "../db/runPendingMigrations.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";

export const healthRouter = Router();

type CheckStatus = "ok" | "warning" | "error";

interface ReadinessCheck {
  area: string;
  status: CheckStatus;
  message: string;
  owner: string;
}

async function getDatabaseStatus(): Promise<"ok" | "error"> {
  try {
    await pingDb();
    return "ok";
  } catch {
    return "error";
  }
}

function buildReadinessChecks(dbStatus: "ok" | "error"): ReadinessCheck[] {
  const migrations = getMigrationHealth();

  return [
    {
      area: "database",
      status: dbStatus === "ok" ? "ok" : "error",
      message: dbStatus === "ok" ? "Primary MySQL connection is reachable." : "Primary MySQL connection failed. Check backend environment and network access.",
      owner: "IT / Backend",
    },
    {
      area: "migrations",
      status: migrations.status === "failed" ? "error" : migrations.skipped.length > 0 ? "warning" : "ok",
      message: migrations.status === "failed"
        ? "One or more migrations failed. Production should not start with incomplete schema."
        : migrations.skipped.length > 0
          ? "Some migrations were skipped. Confirm this is expected for the current database."
          : "Migration runner completed without reported failures.",
      owner: "Backend / DBA",
    },
    {
      area: "attendance_reports",
      status: "warning",
      message: "Validate COSEC sync, active employee date logic, missing punch handling, branch/process/cost-centre filters, and report counts before production sign-off.",
      owner: "WFM / HR / DBA",
    },
    {
      area: "payroll_reports",
      status: "warning",
      message: "Validate salary component breakdown, gross/net totals, payslip PDF values, monthly payroll trend, and maker-checker workflow before payroll publish.",
      owner: "Payroll / Finance / DBA",
    },
    {
      area: "privacy_and_exports",
      status: "warning",
      message: "Sensitive exports should have role checks, review trail, watermarking where applicable, and masked fields for non-authorized users.",
      owner: "Compliance / IT Security",
    },
  ];
}

/**
 * GET /health/live - Liveness probe (process-only, no DB check)
 *
 * For Kubernetes liveness probes. Returns 200 if the process is running.
 * Does NOT check database or external dependencies - those are for readiness.
 * Fast response, no I/O.
 */
healthRouter.get("/live", (_req, res) => {
  return res.status(200).json({
    status: "alive",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready - Readiness probe (basic, public)
 *
 * For Kubernetes readiness probes. Checks database and schema verification status.
 * Returns 200 ONLY when schema state is "verified".
 * SECURITY: Does not expose internal details (filenames, errors, paths).
 *
 * Schema states:
 * - unverified: Schema not checked yet (not ready)
 * - verifying: Check in progress (not ready)
 * - verified: Ready to serve traffic (200)
 * - incompatible: Pending migrations (not ready)
 * - error: Verification failed (not ready)
 */
healthRouter.get("/ready", async (_req, res) => {
  const dbStatus = await getDatabaseStatus();
  const schemaState = getSchemaVerificationState();

  // Ready ONLY when schema is verified AND database is reachable
  const ready = dbStatus === "ok" && isSchemaReady();

  return res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    db: dbStatus,
    schema: schemaState.state,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health - Basic health check (public)
 *
 * HARDENED: Does not expose internal details like migration failures.
 * Returns only healthy/degraded status for external monitoring.
 * Internal details available via /health/readiness (protected).
 */
healthRouter.get("/", async (_req, res) => {
  const dbStatus = await getDatabaseStatus();
  const migrations = getMigrationHealth();
  const healthy = dbStatus === "ok" && migrations.status !== "failed";

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    service: "MCN HRMS Backend API",
    status: healthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/readiness - Detailed readiness check (protected)
 *
 * Full diagnostic information for administrators only.
 * Includes migration status, schema verification, database connectivity, and checklist items.
 * Requires authentication and admin/super_admin role.
 */
healthRouter.get("/readiness", requireAuth, requireRole("admin", "super_admin"), async (_req, res) => {
  const dbStatus = await getDatabaseStatus();
  const migrations = getMigrationHealth();
  const schemaState = getSchemaVerificationState();
  const checks = buildReadinessChecks(dbStatus);
  const hasError = checks.some((check) => check.status === "error");
  const hasWarning = checks.some((check) => check.status === "warning");

  return res.status(hasError ? 503 : 200).json({
    success: !hasError,
    service: "MCN HRMS Backend API",
    status: hasError ? "not_ready" : hasWarning ? "ready_with_warnings" : "ready",
    checks,
    summary: {
      errors: checks.filter((check) => check.status === "error").length,
      warnings: checks.filter((check) => check.status === "warning").length,
      ok: checks.filter((check) => check.status === "ok").length,
      schema: {
        state: schemaState.state,
        applied_count: schemaState.appliedCount,
        pending_count: schemaState.pendingCount,
        pending_files: schemaState.pendingFiles,
        verified_at: schemaState.verifiedAt,
        error: schemaState.error,
      },
      migrations: {
        status: migrations.status,
        applied_count: migrations.applied.length,
        skipped_count: migrations.skipped.length,
        failed_count: migrations.failed.length,
        failed: migrations.failed,
        completed_at: migrations.completedAt,
      },
    },
    timestamp: new Date().toISOString(),
  });
});
