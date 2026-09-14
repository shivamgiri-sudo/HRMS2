import { db } from "../db/mysql.js";
import { logger } from "../logger.js";
import { gstExportService, isValidGstin } from "../modules/gst/gst-export.service.js";
import { registerTimer, unregisterTimer, withWorkerLock } from "./worker-utils.js";
import type { RowDataPacket } from "mysql2";

/**
 * Auto-generates the outward GST export batch for every registration, every month.
 *
 * WHY THIS EXISTS
 * The legacy process was: someone exports a spreadsheet, reconciles it by hand, and hands it to
 * the preparer. Nothing told them a row was unfilable until the portal rejected it. This worker
 * makes the batch and its exception worklist exist BEFORE anyone asks, so the month's problems
 * surface while there is still time to fix the underlying invoice rather than on the due date.
 *
 * WHY IT NEVER TOUCHES AN EXPORTED BATCH
 * Regeneration supersedes. Once a batch is 'exported' it is the artefact a return was prepared
 * from, and silently replacing it would destroy the reproducibility the whole design exists for.
 * The worker therefore only acts when there is no batch for the period, or when the existing one
 * is still 'draft' — i.e. it had exceptions and someone may since have fixed the data. A
 * 'validated' batch is left alone too: it is clean and waiting to be taken.
 *
 * WHY DAILY RATHER THAN MONTHLY
 * A monthly tick has one chance to run. If the process is restarted or the box is down that
 * hour, the month is silently skipped and nobody finds out until filing. Running daily and
 * making the work idempotent means a missed day costs nothing and the batch self-heals.
 *
 * generated_by is left NULL for these runs, which is how an automated batch is distinguished
 * from one a person generated — a human always has an auth_user id.
 */

const WORKER_NAME = "gst-export-auto";

/** Daily. See the header for why this is not a monthly cron. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Keep regenerating the previous month for this many days into the current one.
 *
 * GSTR-1 for a month is due on the 11th of the next. After the window closes the period is
 * almost certainly filed, and continuing to churn batches would just bury the filed one under
 * superseded regenerations. 20 days leaves headroom past the due date without running forever.
 */
const REGENERATION_WINDOW_DAYS = 20;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

/** Previous calendar month as YYYY-MM, computed in local time to match the filing calendar. */
function previousPeriod(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function cycle(): Promise<void> {
  const now = new Date();
  if (now.getDate() > REGENERATION_WINDOW_DAYS) {
    logger.info(
      { worker: WORKER_NAME, dayOfMonth: now.getDate() },
      "[gst-export] outside the regeneration window for the previous period — nothing to do",
    );
    return;
  }
  const period = previousPeriod(now);

  // One row per DISTINCT registration. Several branches share the UP GSTIN, and a return is
  // filed per registration, not per branch — generating once per branch would produce four
  // identical UP batches, each superseding the last.
  const [registrations] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT gstin
       FROM branch_master
      WHERE COALESCE(active_status, 1) = 1
        AND gstin IS NOT NULL AND TRIM(gstin) <> ''`,
  );

  if (!registrations.length) {
    // Not an error worth alerting on every day, but it does mean no return can be produced.
    logger.warn(
      { worker: WORKER_NAME, period },
      "[gst-export] no branch carries a GSTIN — nothing can be generated until branch_master.gstin is populated",
    );
    return;
  }

  for (const row of registrations) {
    const gstin = String(row.gstin).trim().toUpperCase();
    if (!isValidGstin(gstin)) {
      logger.error(
        { worker: WORKER_NAME, gstin, period },
        "[gst-export] branch GSTIN fails its check digit — skipped, since a return generated against it could not be filed",
      );
      continue;
    }

    try {
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id, status, exception_rows
           FROM gst_export_batch
          WHERE export_type = 'GSTR1' AND company_gstin = ? AND period_month = ?
            AND status <> 'superseded'
          LIMIT 1`,
        [gstin, period],
      );

      const current = existing[0];
      if (current && String(current.status) !== "draft") {
        // 'validated' is clean and waiting; 'exported' was filed from. Neither should be replaced.
        continue;
      }

      const result = await gstExportService.generateBatch(
        { exportType: "GSTR1", companyGstin: gstin, periodMonth: period, notes: "Auto-generated" },
        null,
        "system",
      );

      logger.info(
        {
          worker: WORKER_NAME,
          gstin,
          period,
          batchId: result.batchId,
          totalRows: result.totalRows,
          exceptionRows: result.exceptionRows,
          filingReady: result.filingReady,
          regenerated: Boolean(current),
        },
        result.exceptionRows > 0
          ? `[gst-export] ${period} ${gstin}: ${result.exceptionRows} of ${result.totalRows} row(s) cannot be filed — exception worklist is ready`
          : `[gst-export] ${period} ${gstin}: ${result.totalRows} row(s), filing-ready`,
      );
    } catch (error) {
      // One bad registration must not stop the others — each files independently.
      logger.error(
        { worker: WORKER_NAME, gstin, period, err: error },
        "[gst-export] generation failed for this registration",
      );
    }
  }
}

export function startGstExportAutoWorker(): void {
  if (process.env.GST_EXPORT_AUTO_ENABLED === "false") {
    logger.info({ worker: WORKER_NAME }, "[gst-export] disabled (GST_EXPORT_AUTO_ENABLED=false)");
    return;
  }

  // Not on boot: a deploy restarts the process, and a rollout should not trigger a generation
  // sweep across every registration while the app is still settling.
  startupTimer = setTimeout(() => {
    void withWorkerLock(WORKER_NAME, cycle);
  }, 10 * 60 * 1000);
  registerTimer(`${WORKER_NAME}:startup`, startupTimer);

  intervalTimer = setInterval(() => {
    void withWorkerLock(WORKER_NAME, cycle);
  }, INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalTimer);

  logger.info({ worker: WORKER_NAME, intervalMs: INTERVAL_MS }, "[gst-export] scheduled");
}

export function stopGstExportAutoWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}:startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(WORKER_NAME); intervalTimer = null; }
}
