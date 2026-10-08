import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { logger } from "../logger.js";
import {
  missingConfig,
  readGrnTallyConfig,
  runGrnTallyExport,
} from "../modules/finance/grn-tally-export.service.js";
import {
  registerTimer,
  unregisterTimer,
  withWorkerLock,
} from "./worker-utils.js";

/**
 * Writes the day's fully approved GRNs to the Tally connector's folder, once a day.
 *
 * It does nothing until GRN_TALLY_EXPORT_DIR and GRN_TALLY_EXPORT_FROM are both set. It checks every
 * 15 minutes and runs once per day after GRN_TALLY_EXPORT_HOUR (default 20, local time), so a restart
 * or a down box at 8 pm still produces that day's file later in the evening.
 */

const WORKER_NAME = "grn-tally-export";
const TICK_MS = 15 * 60 * 1000;
const DEFAULT_HOUR = 20;

let timer: NodeJS.Timeout | null = null;

async function cycle(): Promise<void> {
  const config = readGrnTallyConfig();
  if (missingConfig(config).length) return;
  const hour = Number(process.env.GRN_TALLY_EXPORT_HOUR);
  const runHour =
    Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_HOUR;
  if (new Date().getHours() < runHour) return;

  const [today] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM grn_tally_export_batch WHERE status = 'written' AND DATE(created_at) = CURDATE() AND trigger_source = 'worker' LIMIT 1`,
  );
  if (today.length) return;

  try {
    const result = await runGrnTallyExport({ trigger: "worker" });
    if (result.status === "written") {
      logger.info(
        { worker: WORKER_NAME, ...result },
        `[grn-tally] wrote ${result.vouchers} voucher(s) to ${result.fileName}`,
      );
    }
    if ("exceptions" in result && result.exceptions.length) {
      logger.warn(
        { worker: WORKER_NAME, exceptions: result.exceptions.slice(0, 20) },
        `[grn-tally] ${result.exceptions.length} approved GRN(s) could not be exported and need Accounts to look at them`,
      );
    }
  } catch (error) {
    logger.error(
      { worker: WORKER_NAME, err: error },
      "[grn-tally] export failed; nothing was marked as exported and the next tick will retry",
    );
  }
}

export function startGrnTallyExportWorker(): void {
  if (process.env.GRN_TALLY_EXPORT_ENABLED === "false") {
    logger.info(
      { worker: WORKER_NAME },
      "[grn-tally] disabled (GRN_TALLY_EXPORT_ENABLED=false)",
    );
    return;
  }
  timer = setInterval(() => {
    void withWorkerLock(WORKER_NAME, cycle);
  }, TICK_MS);
  registerTimer(WORKER_NAME, timer);
  logger.info(
    { worker: WORKER_NAME, tickMs: TICK_MS },
    "[grn-tally] scheduled (idle until GRN_TALLY_EXPORT_DIR and GRN_TALLY_EXPORT_FROM are set)",
  );
}

export function stopGrnTallyExportWorker(): void {
  if (timer) {
    clearInterval(timer);
    unregisterTimer(WORKER_NAME);
    timer = null;
  }
}
