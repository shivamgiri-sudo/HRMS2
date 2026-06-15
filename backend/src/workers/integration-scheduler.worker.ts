import { createHash } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { env } from "../config/env.js";
import { db } from "../db/mysql.js";
import { executeConnector } from "../modules/integration-hub/connectorRunner.js";
import { nextCronRun } from "../modules/integration-hub/cronSchedule.js";
import type {
  IntegrationConfig,
  IntegrationSchedule,
} from "../modules/integration-hub/integration.types.js";

type DueSchedule = IntegrationSchedule & IntegrationConfig;

let pollTimer: NodeJS.Timeout | undefined;
let pollRunning = false;

function lockName(integrationKey: string): string {
  const digest = createHash("sha256").update(integrationKey).digest("hex").slice(0, 40);
  return `hrms:integration:${digest}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(connection: PoolConnection, name: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT GET_LOCK(?, 0) AS acquired",
    [name],
  );
  return Number(rows[0]?.acquired ?? 0) === 1;
}

async function releaseLock(connection: PoolConnection, name: string): Promise<void> {
  try {
    await connection.execute("SELECT RELEASE_LOCK(?)", [name]);
  } catch (error) {
    console.error(`[integration-scheduler] failed to release ${name}:`, error);
  }
}

async function recordSchedulerFailure(
  integrationKey: string,
  error: unknown,
  attempts: number,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await db.execute(
      `INSERT INTO integration_event_log
         (id, integration_key, event_type, description, metadata)
       VALUES (UUID(), ?, 'scheduled_run_failed', ?, ?)`,
      [integrationKey, message, JSON.stringify({ attempts })],
    );
  } catch (logError) {
    console.error(`[integration-scheduler] could not record failure for ${integrationKey}:`, logError);
  }
}

async function executeWithRetries(connector: IntegrationConfig): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= env.INTEGRATION_SCHEDULER_MAX_RETRIES; attempt += 1) {
    try {
      const result = await executeConnector(connector, null, {}, "schedule");
      if (result.status === "failed") {
        const error = new Error(`Connector processing failed for run ${result.run_id}`);
        await recordSchedulerFailure(connector.integration_key, error, attempt);
        throw Object.assign(error, { nonRetryable: true });
      }
      return;
    } catch (error) {
      lastError = error;
      if ((error as { nonRetryable?: boolean })?.nonRetryable) throw error;
      if (attempt < env.INTEGRATION_SCHEDULER_MAX_RETRIES) {
        await wait(env.INTEGRATION_SCHEDULER_RETRY_DELAY_MS * attempt);
      }
    }
  }

  await recordSchedulerFailure(
    connector.integration_key,
    lastError,
    env.INTEGRATION_SCHEDULER_MAX_RETRIES,
  );
  throw lastError;
}

export async function runDueIntegrationSchedule(integrationKey: string): Promise<boolean> {
  const connection = await db.getConnection();
  const name = lockName(integrationKey);

  try {
    if (!(await acquireLock(connection, name))) return false;

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT s.*, ic.*
         FROM integration_schedule s
         JOIN integration_config ic ON ic.integration_key = s.integration_key
        WHERE s.integration_key = ?
          AND s.enabled = 1
          AND ic.active_status = 1
          AND s.next_run_at IS NOT NULL
          AND s.next_run_at <= NOW()
        LIMIT 1`,
      [integrationKey],
    );
    const schedule = rows[0] as DueSchedule | undefined;
    if (!schedule) return false;

    const nextRunAt = nextCronRun(
      schedule.cron_expression,
      new Date(),
      env.INTEGRATION_SCHEDULER_TIMEZONE,
    );

    // Claim this occurrence before I/O starts. The named lock prevents a second
    // backend process from claiming the same connector while this run is active.
    await connection.execute(
      `UPDATE integration_schedule
          SET next_run_at = ?
        WHERE integration_key = ?`,
      [nextRunAt, integrationKey],
    );

    try {
      await executeWithRetries(schedule);
      console.log(`[integration-scheduler] ${integrationKey} completed; next run ${nextRunAt.toISOString()}`);
    } catch (error) {
      console.error(`[integration-scheduler] ${integrationKey} failed:`, error);
    } finally {
      await connection.execute(
        `UPDATE integration_schedule
            SET last_run_at = NOW()
          WHERE integration_key = ?`,
        [integrationKey],
      );
    }

    return true;
  } finally {
    await releaseLock(connection, name);
    connection.release();
  }
}

export async function pollIntegrationSchedules(): Promise<number> {
  if (pollRunning) return 0;
  pollRunning = true;

  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.integration_key
         FROM integration_schedule s
         JOIN integration_config ic ON ic.integration_key = s.integration_key
        WHERE s.enabled = 1
          AND ic.active_status = 1
          AND s.next_run_at IS NOT NULL
          AND s.next_run_at <= NOW()
        ORDER BY s.next_run_at ASC
        LIMIT 25`,
    );

    let claimed = 0;
    for (const row of rows as Array<{ integration_key: string }>) {
      if (await runDueIntegrationSchedule(row.integration_key)) claimed += 1;
    }
    return claimed;
  } finally {
    pollRunning = false;
  }
}

export async function initializeIntegrationSchedules(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT s.integration_key, s.cron_expression
       FROM integration_schedule s
       JOIN integration_config ic ON ic.integration_key = s.integration_key
      WHERE s.enabled = 1
        AND ic.active_status = 1
        AND s.next_run_at IS NULL`,
  );

  let initialized = 0;
  for (const row of rows as Array<{ integration_key: string; cron_expression: string }>) {
    try {
      const nextRunAt = nextCronRun(
        row.cron_expression,
        new Date(),
        env.INTEGRATION_SCHEDULER_TIMEZONE,
      );
      await db.execute(
        "UPDATE integration_schedule SET next_run_at = ? WHERE integration_key = ?",
        [nextRunAt, row.integration_key],
      );
      initialized += 1;
    } catch (error) {
      await recordSchedulerFailure(row.integration_key, error, 0);
      console.error(`[integration-scheduler] invalid schedule for ${row.integration_key}:`, error);
    }
  }

  return initialized;
}

export function startIntegrationScheduler(): void {
  if (pollTimer) return;

  void initializeIntegrationSchedules()
    .then((initialized) => {
      if (initialized > 0) {
        console.log(`[integration-scheduler] initialized ${initialized} next run time(s)`);
      }
      return pollIntegrationSchedules();
    })
    .catch((error) => {
      console.error("[integration-scheduler] initialization failed:", error);
    });

  pollTimer = setInterval(() => {
    void pollIntegrationSchedules().catch((error) => {
      console.error("[integration-scheduler] poll failed:", error);
    });
  }, env.INTEGRATION_SCHEDULER_POLL_MS);
  pollTimer.unref();
}

export function stopIntegrationScheduler(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = undefined;
}
