import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";
import type { RowDataPacket } from "mysql2";

/**
 * Consecutive-failure alerting for Integration Hub connectors.
 *
 * dialer_1 failed 1,047 times in a row across 36 days, hourly, and nothing
 * said so. shivamgiri_quality has failed 2,779 times and has never once
 * succeeded. Both write a `failed` row to integration_connector_run every
 * attempt, so the information was always there — nobody was counting.
 *
 * A run that fails once is noise. A run that has failed every time since its
 * last success is a broken integration, and the difference is a COUNT.
 */

/**
 * Alert at these consecutive-failure counts, then every ALERT_EVERY after.
 *
 * Not "every failure": an hourly connector would emit 24 identical alerts a day
 * and be muted within a week, which is how 1,047 failures stay invisible in the
 * first place. Escalating counts stay noticeable without becoming wallpaper.
 */
export const ALERT_AT = [3, 10, 25, 100] as const;
const ALERT_EVERY = 250;

/**
 * Pure: should a failure at this streak length raise an alert?
 * Separated so the policy is testable without a database.
 */
export function shouldAlertOnFailure(consecutiveFailures: number): boolean {
  if (consecutiveFailures <= 0) return false;
  if ((ALERT_AT as readonly number[]).includes(consecutiveFailures)) return true;
  return consecutiveFailures > ALERT_AT[ALERT_AT.length - 1] && consecutiveFailures % ALERT_EVERY === 0;
}

/**
 * How many times has this connector failed since it last succeeded?
 *
 * Counts runs newer than the most recent `complete`. A connector that has never
 * succeeded — shivamgiri_quality — correctly returns its entire failure history
 * rather than zero.
 */
export async function countConsecutiveFailures(integrationKey: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n
       FROM integration_connector_run
      WHERE integration_key = ?
        AND status = 'failed'
        AND started_at > COALESCE(
              (SELECT MAX(started_at) FROM integration_connector_run
                WHERE integration_key = ? AND status = 'complete'),
              '1970-01-01')`,
    [integrationKey, integrationKey],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Record that a run failed and shout if the streak warrants it.
 *
 * Deliberately swallows its own errors: health reporting must never be the
 * reason a sync fails. It logs the miss instead of propagating.
 */
export async function reportConnectorFailure(
  integrationKey: string,
  errorMessage: string,
): Promise<void> {
  try {
    const streak = await countConsecutiveFailures(integrationKey);
    if (!shouldAlertOnFailure(streak)) return;

    logger.error(
      { integrationKey, consecutiveFailures: streak, errorMessage },
      `[IntegrationHub] ${integrationKey} has failed ${streak} times in a row — no data has been ` +
        `promoted since its last success. This connector needs attention.`,
    );
  } catch (err) {
    logger.warn({ integrationKey, err }, "[IntegrationHub] could not evaluate connector failure streak");
  }
}
