import { Router } from "express";
import { pingDb } from "../db/mysql.js";
import { getMigrationHealth } from "../db/runPendingMigrations.js";

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

healthRouter.get("/", async (_req, res) => {
  const dbStatus = await getDatabaseStatus();
  const migrations = getMigrationHealth();
  const healthy = dbStatus === "ok" && migrations.status !== "failed";

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    service: "MCN HRMS Backend API",
    status: healthy ? "healthy" : "degraded",
    db: dbStatus,
    migrations: {
      status: migrations.status,
      applied_count: migrations.applied.length,
      skipped_count: migrations.skipped.length,
      failed: migrations.failed,
      completed_at: migrations.completedAt,
    },
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/readiness", async (_req, res) => {
  const dbStatus = await getDatabaseStatus();
  const migrations = getMigrationHealth();
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
      migrations: {
        status: migrations.status,
        applied_count: migrations.applied.length,
        skipped_count: migrations.skipped.length,
        failed: migrations.failed,
        completed_at: migrations.completedAt,
      },
    },
    timestamp: new Date().toISOString(),
  });
});
