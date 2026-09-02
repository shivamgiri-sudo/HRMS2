import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger.js";
import { registerTimer, unregisterTimer, withWorkerLock } from "./worker-utils.js";

/**
 * Keeps client_invoice / client_credit_note current against db_bill.
 *
 * The one-time historical cutover (2026-08-19) loaded every db_bill row that existed then;
 * nothing kept running it afterward, so client_invoice — the table the GST/Tally export
 * (gst-export.service.ts) actually reads — became a frozen snapshot while db_bill/I-Spark
 * stayed the system finance keeps invoicing in day to day. Confirmed live 2026-09-02: 19
 * invoices (~Rs 60.78L) raised in db_bill since the cutover were never carried into
 * client_invoice. A GST return generated from mas_hrms on any given day was silently missing
 * whatever had been invoiced in I-Spark since 2026-08-19 — same failure shape as the P&L mirror
 * this worker's sibling (db-bill-finance-sync) already exists to prevent: a stale mirror is
 * worse than an empty one, because the report renders and the numbers look plausible.
 *
 * Runs the existing three-stage cutover pipeline (extract -> validate -> load) as a single
 * child process rather than importing it — sync-ongoing.mjs is the same thing a human runs by
 * hand (`node scripts/client-billing-cutover/sync-ongoing.mjs`), so a scheduled run cannot
 * drift from a manual one. Every stage is an idempotent upsert (staging keyed on src_id,
 * client_invoice/client_credit_note keyed on legacy_id), so re-running against unchanged data
 * is a safe no-op and a failed run is recovered by the next one.
 */

const WORKER_NAME = "client-billing-db-bill-sync";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../../scripts/client-billing-cutover/sync-ongoing.mjs");

/** Once a day is right: db_bill is updated by people during the day, not continuously — same
 *  cadence as db-bill-finance-sync, its sibling mirror onto the same source. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** extract+validate+load over ~11k invoices, generously bounded (observed under 3 minutes). */
const TIMEOUT_MS = 20 * 60 * 1000;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

function runSync(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });

    // A hung sync must not hold the worker lock forever — the next night's run would be
    // skipped silently and the mirror would quietly stop advancing.
    const kill = setTimeout(() => {
      child.kill("SIGTERM");
      logger.error({ worker: WORKER_NAME, timeoutMs: TIMEOUT_MS }, "[client-billing-sync] timed out, killed");
    }, TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(kill);
      const tail = out.trim().split("\n").slice(-20).join("\n");
      if (code === 0) {
        logger.info({ worker: WORKER_NAME }, `[client-billing-sync] completed\n${tail}`);
      } else {
        // Never throws: a failed sync must not take the worker down, and the next run
        // recovers because every stage is an idempotent upsert.
        logger.error(
          { worker: WORKER_NAME, code, stderr: err.trim().slice(0, 2000) },
          `[client-billing-sync] FAILED — client_invoice/client_credit_note stopped advancing, the GST/Tally export is reading stale data\n${tail}`,
        );
      }
      resolve();
    });

    child.on("error", (error) => {
      clearTimeout(kill);
      logger.error({ worker: WORKER_NAME, err: error }, "[client-billing-sync] could not start");
      resolve();
    });
  });
}

async function cycle(): Promise<void> {
  // The lock keeps two application instances from syncing at once. Not for correctness — every
  // write is an upsert — but two concurrent runs would double the load on db_bill, a live
  // production system finance is using at the same time, and on mas_hrms's own connection pool.
  await withWorkerLock(WORKER_NAME, runSync);
}

export function startClientBillingDbBillSyncWorker(): void {
  if (process.env.CLIENT_BILLING_SYNC_ENABLED === "false") {
    logger.info({ worker: WORKER_NAME }, "[client-billing-sync] disabled (CLIENT_BILLING_SYNC_ENABLED=false)");
    return;
  }

  // Deliberately not on boot: a deploy restarts the process, and syncing on every restart
  // would hammer db_bill during a rollout. Ten minutes in, staggered after db-bill-finance-sync's
  // own 5-minute startup delay so the two don't open db_bill connections at the same moment.
  startupTimer = setTimeout(() => {
    void cycle();
  }, 10 * 60 * 1000);
  registerTimer(`${WORKER_NAME}:startup`, startupTimer);

  intervalTimer = setInterval(() => { void cycle(); }, INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalTimer);
  logger.info({ worker: WORKER_NAME, intervalMs: INTERVAL_MS }, "[client-billing-sync] scheduled");
}

export function stopClientBillingDbBillSyncWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}:startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(WORKER_NAME); intervalTimer = null; }
}
