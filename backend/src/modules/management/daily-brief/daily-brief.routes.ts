/**
 * D-1 Daily Manager Intelligence Briefing Engine — Phase B (MVP) preview surface.
 *
 * One route only, dry-run only, no dispatch: admins/super_admins may preview any
 * resolvable employee's brief; every other caller may only preview their own.
 * Mounted in app.ts alongside managementRouter (see app.ts diff).
 */
import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { requireAuth } from "../../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../../shared/accessGuard.js";
import { getBusinessDateIST } from "../../../shared/istDate.js";
import { buildDailyBriefForEmployee, dailyBriefEventCode } from "./daily-brief-dispatch.service.js";
import { WORKER_NAME as DAILY_BRIEF_WORKER_NAME } from "./daily-brief.cron.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

function isValidBusinessDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

router.get("/preview", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const requestedEmployeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const requestedDate = typeof req.query.date === "string" ? req.query.date : undefined;

  if (requestedDate && !isValidBusinessDate(requestedDate)) {
    return res.status(400).json({ success: false, message: "date must be YYYY-MM-DD" });
  }
  const businessDate = requestedDate ?? getBusinessDateIST();

  let targetEmployeeId: string | undefined = requestedEmployeeId;

  if (requestedEmployeeId) {
    // Previewing someone else's brief is an admin-only capability.
    const isPrivileged = await hasRole(userId, "admin", "super_admin");
    if (!isPrivileged) {
      // Self-preview is still allowed even when an employeeId is passed, as long as it
      // resolves to the caller's own employee record.
      const own = await getEmployeeForUser(userId);
      if (!own || own.id !== requestedEmployeeId) {
        return res.status(403).json({ success: false, message: "Forbidden: can only preview your own briefing" });
      }
    }
  } else {
    const own = await getEmployeeForUser(userId);
    if (!own) {
      return res.status(403).json({ success: false, message: "No employee record for this account" });
    }
    targetEmployeeId = own.id;
  }

  const result = await buildDailyBriefForEmployee(targetEmployeeId!, businessDate);
  if (!result.ok) {
    return res.status(409).json({
      success: false,
      message: "Briefing is unavailable for this employee",
      unresolved: result.unresolved,
    });
  }

  res.json({
    success: true,
    data: {
      payload: result.brief,
      html: result.html,
      text: result.text,
      subject: result.subject,
      dryRun: true,
    },
  });
}));

interface WorkerJobRunRow extends RowDataPacket {
  status: "started" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  metadata: unknown;
  error_message: string | null;
}

/**
 * Admin-only run-observability endpoint (spec §38). Reads the most recent
 * completed/failed run's summary counts from worker_job_run — reused rather than a
 * new table (see daily-brief.cron.ts's runManagerDailyBrief, which writes a
 * "started" row and a "completed"/"failed" row with the full recipients-resolved/
 * sent/failed/skipped summary every run). When the last run actually dispatched
 * (dryRun:false), also cross-references dispatch_log's per-status breakdown for
 * that run's event_code as a supplementary check — dry-run runs write nothing to
 * dispatch_log at all, so that block is intentionally omitted for a dry run rather
 * than reported as zero sends.
 */
router.get("/runs/last", h(async (req: AuthenticatedRequest, res: Response) => {
  const isPrivileged = await hasRole(req.authUser!.id, "admin", "super_admin");
  if (!isPrivileged) {
    return res.status(403).json({ success: false, message: "Forbidden: admin/super_admin only" });
  }

  const [rows] = await db.execute<WorkerJobRunRow[]>(
    `SELECT status, started_at, completed_at, duration_ms, metadata, error_message
       FROM worker_job_run
      WHERE worker_name = ? AND status IN ('completed', 'failed')
      ORDER BY started_at DESC
      LIMIT 1`,
    [DAILY_BRIEF_WORKER_NAME],
  );

  const row = rows[0];
  if (!row) {
    return res.status(404).json({ success: false, message: "No manager daily brief run has been recorded yet" });
  }

  const metadata: Record<string, unknown> =
    row.metadata == null ? {} : typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>);

  let dispatchLogByStatus: Record<string, number> | undefined;
  if (metadata.dryRun === false && typeof metadata.businessDate === "string") {
    const [statusRows] = await db.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS n FROM dispatch_log WHERE event_code = ? GROUP BY status`,
      [dailyBriefEventCode(metadata.businessDate)],
    );
    dispatchLogByStatus = {};
    for (const r of statusRows as RowDataPacket[]) {
      dispatchLogByStatus[String(r.status)] = Number(r.n);
    }
  }

  res.json({
    success: true,
    data: {
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      errorMessage: row.error_message,
      summary: metadata,
      dispatchLogByStatus,
    },
  });
}));

export { router as dailyBriefRouter };
