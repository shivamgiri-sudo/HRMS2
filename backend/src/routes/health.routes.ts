import { Router } from "express";
import { pingDb, getCircuitBreakerStatus, resetCircuitBreaker } from "../db/mysql.js";
import { getMigrationHealth, verifySchemaVersion } from "../db/runPendingMigrations.js";
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

type SchemaStatus = Awaited<ReturnType<typeof verifySchemaVersion>>;

async function getDatabaseStatus(): Promise<"ok" | "error"> {
  try {
    await pingDb();
    return "ok";
  } catch {
    return "error";
  }
}

function buildReadinessChecks(dbStatus: "ok" | "error", schemaStatus: SchemaStatus): ReadinessCheck[] {
  return [
    {
      area: "database",
      status: dbStatus === "ok" ? "ok" : "error",
      message: dbStatus === "ok" ? "Primary MySQL connection is reachable." : "Primary MySQL connection failed. Check backend environment and network access.",
      owner: "IT / Backend",
    },
    {
      area: "migrations",
      status: schemaStatus.valid ? "ok" : "error",
      message: schemaStatus.valid
        ? "Schema verification confirms all required migrations are applied."
        : `Schema verification found ${schemaStatus.pendingCount} pending migration(s).`,
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
    success: true,
    status: "alive",
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
  const schemaStatus = await verifySchemaVersion();
  const healthy = dbStatus === "ok" && schemaStatus.valid;

  // SECURITY: Do not expose migration failure details to unauthenticated users
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    service: "MCN HRMS Backend API",
    status: healthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready - Readiness probe (basic, public)
 *
 * For Kubernetes readiness probes. Checks database connectivity.
 * Returns 200 if ready to accept traffic, 503 if not ready.
 */
healthRouter.get("/ready", async (_req, res) => {
  const dbStatus = await getDatabaseStatus();
  const ready = dbStatus === "ok";

  return res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/db-circuit - Circuit breaker status (admin only)
 */
healthRouter.get("/db-circuit", requireAuth, requireRole("admin", "super_admin"), (_req, res) => {
  const cb = getCircuitBreakerStatus();
  const retryAfterMs = cb.status === "open" ? Math.max(0, cb.nextProbeTime - Date.now()) : 0;
  return res.json({
    success: true,
    circuitBreaker: {
      ...cb,
      lastFailure: cb.lastFailure ? new Date(cb.lastFailure).toISOString() : null,
      nextProbeTime: cb.nextProbeTime ? new Date(cb.nextProbeTime).toISOString() : null,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    },
  });
});

/**
 * POST /health/db-circuit/reset - Manually close the circuit breaker (admin only)
 * Use when DB is confirmed healthy but the in-memory breaker is still open after a
 * transient failure. This does NOT restart the process — it only resets the breaker.
 */
healthRouter.post("/db-circuit/reset", requireAuth, requireRole("admin", "super_admin"), async (_req, res) => {
  const before = getCircuitBreakerStatus();
  resetCircuitBreaker();
  // Probe the DB to confirm it's actually reachable before declaring success
  try {
    await pingDb();
    return res.json({
      success: true,
      message: "Circuit breaker reset and DB connectivity confirmed.",
      before: before.status,
      after: "closed",
    });
  } catch (err: any) {
    return res.status(503).json({
      success: false,
      message: "Circuit breaker reset, but DB ping failed — DB may still be unreachable.",
      error: err?.message ?? String(err),
    });
  }
});

/**
 * GET /health/readiness - Detailed readiness check (protected)
 *
 * Full diagnostic information for administrators.
 * Includes migration status, database connectivity, and checklist items.
 */
healthRouter.get("/readiness", requireAuth, requireRole("admin", "super_admin"), async (_req, res) => {
  const dbStatus = await getDatabaseStatus();
  const schemaStatus = await verifySchemaVersion();
  const migrations = getMigrationHealth();
  const checks = buildReadinessChecks(dbStatus, schemaStatus);
  const hasError = checks.some((check) => check.status === "error");
  const hasWarning = checks.some((check) => check.status === "warning");
  const cb = getCircuitBreakerStatus();

  return res.status(hasError ? 503 : 200).json({
    success: !hasError,
    service: "MCN HRMS Backend API",
    status: hasError ? "not_ready" : hasWarning ? "ready_with_warnings" : "ready",
    checks,
    circuitBreaker: {
      status: cb.status,
      failures: cb.failures,
      lastFailure: cb.lastFailure ? new Date(cb.lastFailure).toISOString() : null,
      nextProbeTime: cb.nextProbeTime ? new Date(cb.nextProbeTime).toISOString() : null,
    },
    summary: {
      errors: checks.filter((check) => check.status === "error").length,
      warnings: checks.filter((check) => check.status === "warning").length,
      ok: checks.filter((check) => check.status === "ok").length,
      migrations: {
        status: schemaStatus.valid ? "ok" : "failed",
        applied_count: schemaStatus.appliedCount,
        pending_count: schemaStatus.pendingCount,
        pending_files: schemaStatus.pendingFiles,
        runner_status: migrations.status,
        runner_applied_count: migrations.applied.length,
        runner_skipped_count: migrations.skipped.length,
        failed_count: migrations.failed.length,
        // Only include failure details in protected endpoint
        failed: migrations.failed,
        completed_at: migrations.completedAt,
      },
    },
    timestamp: new Date().toISOString(),
  });
});
