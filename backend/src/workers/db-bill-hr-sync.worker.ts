import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger.js";
import { registerTimer, unregisterTimer, withWorkerLock } from "./worker-utils.js";

/**
 * Keeps the db_bill HR snapshot tables current in mas_hrms.
 *
 * New salary rows enter db_bill each month when payroll closes. Without an automated mirror, the
 * HRMS salary register and legacy audit trail fall behind db_bill by however long it has been
 * since the last manual sync.
 *
 * Covered tables (see sync-all-tables-from-dbbill.mjs for the full list): revenue target/actual
 * snapshots, employee_salary_history (is_current=0, historical only), OD register, legacy salary,
 * documents, income tax, DOJ changes, employee moves, field attendance, qual_* and salary-upload
 * snapshots. All additive (INSERT / INSERT IGNORE, existence-checked first), never deletes.
 *
 * DELIBERATELY NOT RUN HERE, pending an owner decision with real gap numbers in front of them:
 *
 *   - leave_request and employee_loans gap-fill (inside sync-all-tables-from-dbbill.mjs, run
 *     with --skip-leave-gap --skip-loan-gap below). Every other table this script touches is a
 *     pure audit/snapshot table nothing else reads; these two are live operational tables —
 *     leave_request feeds leave balance, employee_loans feeds payroll deduction. Backfilling old
 *     legacy rows into them can shift a real employee's current balance or take-home pay, which
 *     is a decision for a person with the actual row count, not a nightly cron.
 *   - sync-salary-gap-from-dbbill.mjs entirely. It inserts new salary_prep_line /
 *     salary_prep_line_component rows for FINALIZED historical payroll runs — i.e. it can change
 *     a closed month's payroll, P&L and statutory numbers after the fact. That is exactly what
 *     [[hrms2-never-change-salary-calculation]] exists to guard against; it is not spawned here
 *     at all and is not copied into dist/scripts (copy-runtime-scripts.mjs), so it stays a
 *     manual, reviewed run until the owner explicitly signs off on enabling it.
 *
 * Attendance (2.26M rows) is a separate script (sync-attendance-legacy.mjs), run monthly by hand,
 * not by this worker.
 */

const WORKER_NAME = "db-bill-hr-sync";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_NAME = "sync-all-tables-from-dbbill.mjs";

/**
 * Where the sync script can be, in the order it is looked for — same fallback as
 * db-bill-finance-sync.worker.ts, after that worker's script silently 404'd every night from
 * 2026-08-19 because tsc never emits a .mjs and deploy.yml ships only backend/dist:
 *   1. ../../scripts     dev: backend/scripts; prod: backend/dist/scripts, filled by the build
 *                        (scripts/copy-runtime-scripts.mjs).
 *   2. ../../../scripts  prod fallback: the server's git tree, backend/scripts.
 */
export function syncScriptCandidates(dir: string = __dirname): string[] {
  return [
    path.resolve(dir, "../../scripts", SCRIPT_NAME),
    path.resolve(dir, "../../../scripts", SCRIPT_NAME),
  ];
}

export function resolveSyncScript(dir: string = __dirname, exists: (p: string) => boolean = fs.existsSync): string | null {
  return syncScriptCandidates(dir).find((candidate) => exists(candidate)) ?? null;
}

/** Daily — salary upload and incentive data changes every month; revenue daily. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 30 minutes headroom: the full run handles ~750K rows and is observed at ~15 minutes. */
const TIMEOUT_MS = 30 * 60 * 1000;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

function runSync(): Promise<void> {
  const script = resolveSyncScript();
  if (!script) {
    logger.error(
      { worker: WORKER_NAME, looked: syncScriptCandidates() },
      "[hr-sync] FAILED — sync script not found; the HR snapshot tables are not advancing",
    );
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--skip-leave-gap", "--skip-loan-gap"], {
      cwd: path.resolve(path.dirname(script), ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });

    const kill = setTimeout(() => {
      child.kill("SIGTERM");
      logger.error({ worker: WORKER_NAME, script, timeoutMs: TIMEOUT_MS }, "[hr-sync] timed out, killed");
    }, TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(kill);
      const tail = out.trim().split("\n").slice(-12).join("\n");
      if (code === 0) {
        logger.info({ worker: WORKER_NAME }, `[hr-sync] OK\n${tail}`);
      } else {
        // Never throws: a failed sync must not take the worker down, and every write here is
        // additive, so the next run recovers on its own.
        logger.error(
          { worker: WORKER_NAME, code, stderr: err.trim().slice(0, 2000) },
          `[hr-sync] FAILED — HR snapshot tables may be stale\n${tail}`,
        );
      }
      resolve();
    });

    child.on("error", (error) => {
      clearTimeout(kill);
      logger.error({ worker: WORKER_NAME, script, err: error }, "[hr-sync] could not start");
      resolve();
    });
  });
}

async function cycle(): Promise<void> {
  await withWorkerLock(WORKER_NAME, runSync);
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
