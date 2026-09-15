import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger.js";
import { registerTimer, unregisterTimer, withWorkerLock } from "./worker-utils.js";

/**
 * Keeps the db_bill finance mirror current.
 *
 * db_bill is where finance actually raises invoices, budgets and GRNs; mas_hrms only mirrors
 * them, and the P&L reads the mirror. The sync existed but nothing ever called it — it was run
 * by hand. The invoice snapshot was consequently nine days stale when this was written, short
 * 11 invoices worth Rs 59 lakh for July alone, and the budget, GRN and invoice-line mirrors
 * would simply never have gained an August row.
 *
 * A stale mirror is worse than an empty one: the P&L renders, the figures look plausible, and
 * nothing indicates the month is half-reported.
 *
 * Runs the existing script as a child process rather than importing it. The script is a
 * standalone .mjs with its own connection handling, it is the same thing a human runs by hand,
 * and keeping one code path means a scheduled run cannot drift from a manual one.
 */

const WORKER_NAME = "db-bill-finance-sync";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_NAME = "sync-db-bill-snapshot.mjs";

/**
 * Where the sync script can be, in the order it is looked for.
 *
 * FOUND 2026-09-15: this was a single `../../scripts` path, which is right from src/workers in
 * dev (-> backend/scripts) and WRONG from the compiled worker in production, which runs from
 * backend/dist/src/workers (-> backend/dist/scripts). tsc never emits a .mjs file and deploy.yml
 * ships only backend/dist and backend/sql, so that file did not exist and every nightly run
 * exited with MODULE_NOT_FOUND into a log line. The billing mirror stopped at 2026-08-19 18:43
 * IST while db_bill went on to hold Rs 274.10 lakh of August invoices, and Live P&L showed
 * August revenue as Rs 0.
 *
 *   1. ../../scripts     dev: backend/scripts; prod: backend/dist/scripts, which the build now
 *                        fills (scripts/copy-runtime-scripts.mjs), so each deploy ships the
 *                        script version that matches its code.
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

/**
 * The child's environment. The script reads backend/.env relative to ITS OWN location, which
 * the copy in dist/scripts cannot see, so it is handed the app's already-loaded settings instead
 * — in particular HRMS_DB_HOST, without which it falls back to a hardcoded office-LAN address.
 * An empty BILL_DB_HOST is dropped so the script's own default applies rather than "".
 */
export function syncChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  if (!out.HRMS_DB_HOST && out.DB_HOST) out.HRMS_DB_HOST = out.DB_HOST;
  if (out.BILL_DB_HOST === "") delete out.BILL_DB_HOST;
  return out;
}

/** Once a day is right: db_bill is updated by people during the day, not continuously. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Long enough for a full mirror (~2 minutes observed) with generous headroom. */
const TIMEOUT_MS = 20 * 60 * 1000;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

function runSync(): Promise<void> {
  const script = resolveSyncScript();
  if (!script) {
    logger.error(
      { worker: WORKER_NAME, looked: syncScriptCandidates() },
      "[db-bill-sync] FAILED — sync script not found; the P&L is reading a mirror that stopped advancing",
    );
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: path.resolve(path.dirname(script), ".."),
      env: syncChildEnv(),
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
      logger.error({ worker: WORKER_NAME, timeoutMs: TIMEOUT_MS }, "[db-bill-sync] timed out, killed");
    }, TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(kill);
      const tail = out.trim().split("\n").slice(-12).join("\n");
      if (code === 0) {
        logger.info({ worker: WORKER_NAME }, `[db-bill-sync] completed\n${tail}`);
      } else {
        // Never throws: a failed mirror must not take the worker down, and the next run
        // recovers because every sync is an idempotent upsert.
        logger.error(
          { worker: WORKER_NAME, code, stderr: err.trim().slice(0, 2000) },
          `[db-bill-sync] FAILED — the P&L is now reading a mirror that stopped advancing\n${tail}`,
        );
      }
      resolve();
    });

    child.on("error", (error) => {
      clearTimeout(kill);
      logger.error({ worker: WORKER_NAME, err: error }, "[db-bill-sync] could not start");
      resolve();
    });
  });
}

async function cycle(): Promise<void> {
  // The lock keeps two application instances from mirroring at once. Not for correctness —
  // every write is an upsert — but two concurrent runs would double the load on db_bill,
  // which is a live production system that finance is using at the same time.
  await withWorkerLock(WORKER_NAME, runSync);
}

export function startDbBillFinanceSyncWorker(): void {
  if (process.env.DB_BILL_SYNC_ENABLED === "false") {
    logger.info({ worker: WORKER_NAME }, "[db-bill-sync] disabled (DB_BILL_SYNC_ENABLED=false)");
    return;
  }

  // Deliberately not on boot: a deploy restarts the process, and syncing on every restart
  // would hammer db_bill during a rollout. Five minutes in, once things have settled.
  startupTimer = setTimeout(() => {
    void cycle();
  }, 5 * 60 * 1000);
  registerTimer(`${WORKER_NAME}:startup`, startupTimer);

  intervalTimer = setInterval(() => { void cycle(); }, INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalTimer);
  logger.info({ worker: WORKER_NAME, intervalMs: INTERVAL_MS }, "[db-bill-sync] scheduled");
}

export function stopDbBillFinanceSyncWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}:startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(WORKER_NAME); intervalTimer = null; }
}
