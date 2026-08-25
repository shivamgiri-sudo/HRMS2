import { Router } from "express";
import { pingDb, getCircuitBreakerStatus, resetCircuitBreaker } from "../db/mysql.js";
import { getMigrationHealth, verifySchemaVersion, getSchemaVerificationState } from "../db/runPendingMigrations.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";

export const healthRouter = Router();

// TEMP TEST ENDPOINT - REMOVE AFTER TESTING
healthRouter.get("/test-daily-report", async (req, res) => {
  try {
    const { runDailyHiringReport } = await import("../modules/ats/ats-reminders.cron.js");
    const result = await runDailyHiringReport('2026-08-24', 'shivam.giri@teammas.in');
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// BuildInfo/readBuildInfo moved to shared/buildInfo.ts so the worker entrypoint reports the
// SAME stamp rather than carrying a second copy that could drift. Re-exported because other
// modules already import them from here.
export { readBuildInfo, type BuildInfo } from "../shared/buildInfo.js";
// `export ... from` re-exports without binding locally, and this file calls it below.
import { readBuildInfo } from "../shared/buildInfo.js";

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
 *
 * PERF: was `await verifySchemaVersion()` on every hit — that opens a brand
 * new unpooled `mysql.createConnection` (full TCP+auth handshake) plus 2-3
 * queries, every single time this public, frequently-polled endpoint is
 * called. Measured ~2.5-2.9s per call against the live DB, entirely from
 * connection setup, not query cost. Schema version is verified once at boot
 * (server.ts) and after any `npm run migrate` run — it does not change
 * mid-process in this deployment (SKIP_MIGRATIONS=true means prod schema
 * changes require an explicit migrate + restart, see memory
 * hrms2-migrations-dont-run-at-boot). getSchemaVerificationState() reads
 * that already-computed result from memory — zero DB cost.
 *
 * Self-heal on the unhappy path only: if the cached state says invalid, that
 * could be a real pending migration OR a transient boot-time DB hiccup that
 * never gets re-checked afterwards (verificationState is set once and never
 * refreshed otherwise — confirmed live: a boot that raced a network switch
 * cached "invalid" from one ETIMEDOUT while /health/readiness's fresh check
 * showed 451/451 applied and valid seconds later). One extra live check only
 * fires in the already-slow "something looks wrong" path, never on the
 * common healthy one.
 */
healthRouter.get("/", async (req, res) => {
  // TEMP: Check for test parameter
  const testReport = req.query.testReport;
  if (testReport === 'yes') {
    try {
      const { runDailyHiringReport } = await import("../modules/ats/ats-reminders.cron.js");
      const result = await runDailyHiringReport('2026-08-24', 'shivam.giri@teammas.in');
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  const dbStatus = await getDatabaseStatus();
  let schemaStatus = getSchemaVerificationState();
  if (!schemaStatus.valid) {
    schemaStatus = await verifySchemaVersion();
  }
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
 * GET /health/version - What is actually running here.
 *
 * The readiness audit lists this as Required, and the gap is not theoretical: with no
 * runtime SHA anywhere, confirming a deploy landed meant reading CI logs and assuming the
 * runner's workspace matched the server. That is the assumption a release gate exists to
 * test. Compare `commit` against the SHA you intended to ship.
 *
 * Public and unauthenticated, deliberately — a release check is useless if it needs a
 * login, and the payload carries no secret: a commit SHA of a repository, a build
 * timestamp, and counts. It reports no migration NAMES, matching the existing decision on
 * GET /health not to expose migration failure detail to anonymous callers.
 *
 * `schema.pending` is the number of migrations the runner still has to apply. Non-zero
 * means the code and the database are from different releases, which is the failure this
 * endpoint is really for — a matching SHA with pending migrations is still a broken deploy.
 */
healthRouter.get("/version", async (_req, res) => {
  const build = readBuildInfo();
  const schemaStatus = await verifySchemaVersion();

  return res.status(200).json({
    success: true,
    service: "MCN HRMS Backend API",
    // "unknown" is honest. A build that could not stamp itself must not be reported as
    // matching whatever the caller hoped for.
    commit: build.commit,
    branch: build.branch,
    builtAt: build.builtAt,
    startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
    runtime: {
      node: process.version,
      // Backend and workers run from the same dist but as separate pm2 processes. Asking
      // each one which role it is makes a version divergence between them observable
      // rather than assumed.
      role: process.env.WORKERS_PROCESS === "external" ? "api" : "api+workers",
      env: process.env.NODE_ENV ?? "unknown",
    },
    schema: {
      valid: schemaStatus.valid,
      applied: schemaStatus.appliedCount,
      pending: schemaStatus.pendingCount,
    },
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
