import { db } from "../db/mysql.js";
import { logger } from "../logger.js";
import {
  buildDigest,
  collectGrnIntegrity,
} from "../modules/finance/grn-integrity-alerts.js";
import { inboxService } from "../modules/inbox/inbox.service.js";
import { resolveRoleHolderUserIds } from "../shared/recipient-resolver.js";
import {
  registerTimer,
  unregisterTimer,
  withWorkerLock,
} from "./worker-utils.js";

/**
 * Daily GRN check for the Accounts Head and Finance Head, sent to their work inbox after
 * GRN_INTEGRITY_ALERT_HOUR (default 20, local time). Silent when nothing is flagged. The inbox item is
 * keyed by date, so a restart on the same day refreshes the message instead of sending a second one.
 */

const WORKER_NAME = "grn-integrity-alerts";
const TICK_MS = 30 * 60 * 1000;
const DEFAULT_HOUR = 20;
const RECIPIENT_ROLES = ["accounts_head", "finance_head"] as const;

let timer: NodeJS.Timeout | null = null;
let lastRunDay = "";

async function cycle(): Promise<void> {
  const hour = Number(process.env.GRN_INTEGRITY_ALERT_HOUR);
  const runHour =
    Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_HOUR;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getHours() < runHour || lastRunDay === day) return;

  const digest = buildDigest(
    await collectGrnIntegrity(db),
    now.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  );
  lastRunDay = day;
  if (!digest) return;

  const recipients = new Set<string>();
  for (const role of RECIPIENT_ROLES)
    for (const id of await resolveRoleHolderUserIds(role, null))
      recipients.add(id);
  for (const userId of recipients) {
    await inboxService.createItem({
      user_id: userId,
      type: "grn_integrity_digest",
      title: digest.title,
      description: digest.description,
      entity_type: "grn_integrity",
      entity_id: day,
      action_url: "/finance/grn",
      priority: digest.urgent ? "high" : "medium",
    });
  }
  logger.info(
    { worker: WORKER_NAME, recipients: recipients.size },
    `[grn-integrity] ${digest.title}`,
  );
}

export function startGrnIntegrityAlertsWorker(): void {
  if (process.env.GRN_INTEGRITY_ALERTS_ENABLED === "false") {
    logger.info(
      { worker: WORKER_NAME },
      "[grn-integrity] disabled (GRN_INTEGRITY_ALERTS_ENABLED=false)",
    );
    return;
  }
  timer = setInterval(() => {
    void withWorkerLock(WORKER_NAME, cycle).catch((error) =>
      logger.error(
        { worker: WORKER_NAME, err: error },
        "[grn-integrity] check failed",
      ),
    );
  }, TICK_MS);
  registerTimer(WORKER_NAME, timer);
  logger.info(
    { worker: WORKER_NAME, tickMs: TICK_MS },
    "[grn-integrity] scheduled",
  );
}

export function stopGrnIntegrityAlertsWorker(): void {
  if (timer) {
    clearInterval(timer);
    unregisterTimer(WORKER_NAME);
    timer = null;
  }
}
