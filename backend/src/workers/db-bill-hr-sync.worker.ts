import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger.js";
import { registerTimer, unregisterTimer, withWorkerLock } from "./worker-utils.js";

/**
 * Keeps the db_bill HR snapshot tables current in mas_hrms.
 *
 * New salary rows enter db_bill each month when payroll closes. Attendance records
 * arrive daily. Without an automated mirror, the HRMS salary register and attendance
 * reports fall behind db_bill by however long it has been since the last manual sync.
 *
 * Covered tables (see sync-all-tables-from-dbbill.mjs for the full list):
 *   - bill_revenue_target_snapshot / bill_revenue_actual_snapshot
 *   - salary_upload_snapshot, incentive_upload_snapshot, upload_deduction_snapshot
 *   - qual_incentive_snapshot, qual_salary_snapshot, qual_attendance_snapshot, qual_leave_snapshot
 *   - field_attendance_snapshot, od_register_snapshot, employee_move_snapshot
 *   - incometax_legacy_snapshot, change_doj_snapshot, doc_legacy_snapshot
 *   - leave_request (legacy gap fill)
 *   - employee_salary_history (data_migration rows)
 *
 * Attendance (2.26M rows) runs as a separate script: sync-attendance-legacy.mjs.
 * It is run monthly (not daily) to avoid hammering the source DB.
 *
 * All syncs are INSERT IGNORE / never-delete. A failed run never corrupts the mirror.
 */

const WORKER_NAME = "db-bill-hr-sync";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_MAIN = path.resolve(__dirname, "../../scripts/sync-all-tables-from-dbbill.mjs");
const SCRIPT_SALARY_GAP = path.resolve(__dirname, "../../scripts/sync-salary-gap-from-dbbill.mjs");

/** Daily — salary upload and incentive data changes every month; revenue daily. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 30 minutes headroom: the full run handles ~750K rows and is observed at ~15 minutes. */
const TIMEOUT_MS = 30 * 60 * 1000;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

function spawnScript(scriptPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });

    const kill = setTimeout(() => {
      child.kill("SIGTERM");
      logger.error({ worker: WORKER_NAME, script: scriptPath, timeoutMs: TIMEOUT_MS }, "[hr-sync] timed out, killed");
    }, TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(kill);
      const tail = out.trim().split("\n").slice(-8).join("\n");
      if (code === 0) {
        logger.info({ worker: WORKER_NAME, script: path.basename(scriptPath) }, `[hr-sync] OK\n${tail}`);
      } else {
        logger.error(
          { worker: WORKER_NAME, script: path.basename(scriptPath), code, stderr: err.trim().slice(0, 2000) },
          `[hr-sync] FAILED — HR snapshot tables may be stale\n${tail}`,
        );
      }
      resolve(code);
    });

    child.on("error", (error) => {
      clearTimeout(kill);
      logger.error({ worker: WORKER_NAME, script: scriptPath, err: error }, "[hr-sync] could not start");
      resolve(null);
    });
  });
}

async function cycle(): Promise<void> {
  await withWorkerLock(WORKER_NAME, async () => {
    // 1. Sync all non-attendance HR tables
    await spawnScript(SCRIPT_MAIN);
    // 2. Fill salary_prep_line gaps for newly hired employees
    await spawnScript(SCRIPT_SALARY_GAP);
  });
}

export function startDbBillHrSyncWorker(): void {
  if (process.env.DB_BILL_HR_SYNC_ENABLED === "false") {
    logger.info({ worker: WORKER_NAME }, "[hr-sync] disabled (DB_BILL_HR_SYNC_ENABLED=false)");
    return;
  }

  // Run 10 minutes after startup (after the finance sync to avoid concurrent db_bill load)
  startupTimer = setTimeout(() => {
    void cycle();
  }, 10 * 60 * 1000);
  registerTimer(`${WORKER_NAME}:startup`, startupTimer);

  intervalTimer = setInterval(() => { void cycle(); }, INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalTimer);
  logger.info({ worker: WORKER_NAME, intervalMs: INTERVAL_MS }, "[hr-sync] scheduled");
}

export function stopDbBillHrSyncWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}:startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(WORKER_NAME); intervalTimer = null; }
}
