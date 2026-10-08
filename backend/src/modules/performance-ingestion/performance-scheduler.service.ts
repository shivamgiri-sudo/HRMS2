import { CronExpressionParser } from "cron-parser";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  registerTimer,
  unregisterTimer,
  withWorkerLock,
} from "../../workers/worker-utils.js";
import { performanceGovernanceService } from "./performance-governance.service.js";
import { performanceIngestionService } from "./performance-ingestion.service.js";

const WORKER_NAME = "performance-ingestion-scheduler";
const TIMER_NAME = "performance-ingestion-scheduler-timer";
const POLL_INTERVAL_MS = 60_000;
const MINIMUM_SCHEDULE_INTERVAL_MS = 5 * 60_000;

type ScheduleRow = RowDataPacket & {
  id: string;
  dataset_key: string;
  dataset_name: string;
  source_type: "mysql" | "mssql" | "google_sheet";
  timezone_name: string | null;
  schedule_cron: string;
  config_json: string | Record<string, unknown> | null;
  created_at: Date | string;
  last_schedule_attempt_at: Date | string | null;
  last_schedule_status: string | null;
  checkpoint_value: string | null;
};

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validTimezone(timezone: string): string {
  const value = timezone.trim() || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw Object.assign(new Error(`Invalid IANA timezone: ${value}`), {
      statusCode: 400,
    });
  }
}

export function validatePerformanceCron(
  expression: string,
  timezone = "Asia/Kolkata",
): { expression: string; timezone: string; nextRunAt: string } {
  const normalised = expression.trim();
  if (!normalised) {
    throw Object.assign(new Error("Cron expression is required"), {
      statusCode: 400,
    });
  }
  const tz = validTimezone(timezone);

  try {
    const interval = CronExpressionParser.parse(normalised, {
      currentDate: new Date(),
      tz,
    });
    const first = interval.next().toDate();
    const second = interval.next().toDate();
    if (second.getTime() - first.getTime() < MINIMUM_SCHEDULE_INTERVAL_MS) {
      throw Object.assign(
        new Error("Performance source schedules cannot run more often than every five minutes"),
        { statusCode: 400 },
      );
    }
    return {
      expression: normalised,
      timezone: tz,
      nextRunAt: first.toISOString(),
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    throw Object.assign(
      new Error(error instanceof Error ? `Invalid cron expression: ${error.message}` : "Invalid cron expression"),
      { statusCode: 400 },
    );
  }
}

function nextRunAt(
  expression: string,
  timezone: string,
  currentDate: Date,
): Date {
  return CronExpressionParser.parse(expression, {
    currentDate,
    tz: timezone,
  }).next().toDate();
}

function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function subtractDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - Math.max(0, days));
  return date.toISOString().slice(0, 10);
}

function lookbackDays(config: Record<string, unknown>): number {
  const value = Math.trunc(Number(config.scheduleLookbackDays ?? 2));
  if (!Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(31, value));
}

async function scheduleRow(datasetId: string): Promise<ScheduleRow> {
  const [rows] = await db.execute<ScheduleRow[]>(
    `SELECT
       psd.id,
       psd.dataset_key,
       psd.dataset_name,
       psd.source_type,
       psd.timezone_name,
       psd.schedule_cron,
       psd.config_json,
       psd.created_at,
       (
         SELECT pir.created_at
           FROM performance_ingestion_run pir
          WHERE pir.dataset_id = psd.id
            AND pir.trigger_type = 'schedule'
          ORDER BY pir.created_at DESC
          LIMIT 1
       ) AS last_schedule_attempt_at,
       (
         SELECT pir.status
           FROM performance_ingestion_run pir
          WHERE pir.dataset_id = psd.id
            AND pir.trigger_type = 'schedule'
          ORDER BY pir.created_at DESC
          LIMIT 1
       ) AS last_schedule_status,
       pic.checkpoint_value
     FROM performance_source_dataset psd
     LEFT JOIN performance_ingestion_checkpoint pic ON pic.dataset_id = psd.id
     WHERE psd.id = ?
     LIMIT 1`,
    [datasetId],
  );
  if (!rows[0]) {
    throw Object.assign(new Error("Performance dataset not found"), {
      statusCode: 404,
    });
  }
  return rows[0];
}

async function executeScheduledDataset(row: ScheduleRow): Promise<void> {
  const timezone = validTimezone(row.timezone_name ?? "Asia/Kolkata");
  const to = dateInTimezone(new Date(), timezone);
  const config = parseJson(row.config_json);
  const overlapDays = lookbackDays(config);
  const checkpoint = row.checkpoint_value && /^\d{4}-\d{2}-\d{2}$/.test(String(row.checkpoint_value))
    ? String(row.checkpoint_value)
    : to;
  const anchor = checkpoint < to ? checkpoint : to;
  const from = subtractDays(anchor, overlapDays - 1);

  await withWorkerLock(`${WORKER_NAME}:${row.id}`, async () => {
    await performanceIngestionService.run({
      datasetId: row.id,
      mode: "publish",
      triggerType: "schedule",
      from,
      to,
      requestedBy: null,
    });
  });
}

async function dueScheduledDatasets(now = new Date()): Promise<ScheduleRow[]> {
  const [rows] = await db.execute<ScheduleRow[]>(
    `SELECT
       psd.id,
       psd.dataset_key,
       psd.dataset_name,
       psd.source_type,
       psd.timezone_name,
       psd.schedule_cron,
       psd.config_json,
       psd.created_at,
       (
         SELECT pir.created_at
           FROM performance_ingestion_run pir
          WHERE pir.dataset_id = psd.id
            AND pir.trigger_type = 'schedule'
          ORDER BY pir.created_at DESC
          LIMIT 1
       ) AS last_schedule_attempt_at,
       (
         SELECT pir.status
           FROM performance_ingestion_run pir
          WHERE pir.dataset_id = psd.id
            AND pir.trigger_type = 'schedule'
          ORDER BY pir.created_at DESC
          LIMIT 1
       ) AS last_schedule_status,
       pic.checkpoint_value
     FROM performance_source_dataset psd
     LEFT JOIN performance_ingestion_checkpoint pic ON pic.dataset_id = psd.id
     WHERE psd.active_status = 1
       AND psd.approval_status = 'active'
       AND psd.source_type IN ('mysql', 'mssql', 'google_sheet')
       AND psd.schedule_cron IS NOT NULL
       AND TRIM(psd.schedule_cron) <> ''`,
  );

  return rows.filter((row) => {
    try {
      const timezone = validTimezone(row.timezone_name ?? "Asia/Kolkata");
      const reference = row.last_schedule_attempt_at
        ? new Date(row.last_schedule_attempt_at)
        : new Date(row.created_at);
      return nextRunAt(row.schedule_cron, timezone, reference).getTime() <= now.getTime();
    } catch (error) {
      console.error(
        `[${WORKER_NAME}] invalid schedule for ${row.dataset_key}:`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  });
}

export async function runPerformanceIngestionSchedulerOnce(): Promise<void> {
  await withWorkerLock(WORKER_NAME, async () => {
    const datasets = await dueScheduledDatasets();
    for (const dataset of datasets) {
      try {
        await executeScheduledDataset(dataset);
        console.log(`[${WORKER_NAME}] published ${dataset.dataset_key}`);
      } catch (error) {
        console.error(
          `[${WORKER_NAME}] ${dataset.dataset_key} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  });
}

export function startPerformanceIngestionScheduler(): void {
  const timer = setInterval(() => {
    void runPerformanceIngestionSchedulerOnce().catch((error) =>
      console.error(
        `[${WORKER_NAME}] poll failed:`,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }, POLL_INTERVAL_MS);
  timer.unref();
  registerTimer(TIMER_NAME, timer);

  const initialTimer = setTimeout(() => {
    void runPerformanceIngestionSchedulerOnce().catch((error) =>
      console.error(
        `[${WORKER_NAME}] initial run failed:`,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }, 30_000);
  initialTimer.unref();
  registerTimer(`${TIMER_NAME}:initial`, initialTimer);
}

export function stopPerformanceIngestionScheduler(): void {
  unregisterTimer(TIMER_NAME);
  unregisterTimer(`${TIMER_NAME}:initial`);
}

export const performanceSchedulerService = {
  async getSchedule(userId: string, datasetId: string) {
    await performanceGovernanceService.assertDatasetAccess(userId, datasetId);
    const row = await scheduleRow(datasetId);
    const timezone = validTimezone(row.timezone_name ?? "Asia/Kolkata");
    const expression = row.schedule_cron?.trim() || null;
    const reference = row.last_schedule_attempt_at
      ? new Date(row.last_schedule_attempt_at)
      : new Date();
    const next = expression
      ? nextRunAt(expression, timezone, reference).toISOString()
      : null;
    return {
      enabled: Boolean(expression),
      cronExpression: expression,
      timezone,
      scheduleLookbackDays: lookbackDays(parseJson(row.config_json)),
      nextRunAt: next,
      lastRunAt: row.last_schedule_attempt_at
        ? new Date(row.last_schedule_attempt_at).toISOString()
        : null,
      lastRunStatus: row.last_schedule_status ? String(row.last_schedule_status) : null,
      automaticSourceSupported: ["mysql", "mssql", "google_sheet"].includes(row.source_type),
    };
  },

  async setSchedule(userId: string, datasetId: string, input: {
    cronExpression: string | null;
    scheduleLookbackDays: number;
  }) {
    const dataset = await performanceGovernanceService.assertDatasetAccess(userId, datasetId);
    if (["excel", "csv"].includes(dataset.sourceType) && input.cronExpression) {
      throw Object.assign(
        new Error("Excel and CSV sources require a file upload and cannot be scheduled automatically"),
        { statusCode: 409 },
      );
    }

    const lookback = Math.max(1, Math.min(31, Math.trunc(input.scheduleLookbackDays)));
    const cron = input.cronExpression?.trim() || null;
    const validated = cron
      ? validatePerformanceCron(cron, dataset.timezoneName)
      : null;

    await db.execute(
      `UPDATE performance_source_dataset
          SET schedule_cron = ?,
              config_json = JSON_SET(
                COALESCE(config_json, JSON_OBJECT()),
                '$.scheduleLookbackDays',
                ?
              ),
              updated_at = NOW()
        WHERE id = ?`,
      [validated?.expression ?? null, lookback, dataset.id],
    );

    return {
      enabled: Boolean(validated),
      cronExpression: validated?.expression ?? null,
      timezone: dataset.timezoneName,
      scheduleLookbackDays: lookback,
      nextRunAt: validated?.nextRunAt ?? null,
    };
  },

  async runNow(userId: string, datasetId: string) {
    const dataset = await performanceGovernanceService.assertDatasetAccess(userId, datasetId);
    if (["excel", "csv"].includes(dataset.sourceType)) {
      throw Object.assign(
        new Error("Excel and CSV sources must be run with an uploaded file"),
        { statusCode: 409 },
      );
    }
    const row = await scheduleRow(dataset.id);
    const timezone = validTimezone(row.timezone_name ?? "Asia/Kolkata");
    const to = dateInTimezone(new Date(), timezone);
    const config = parseJson(row.config_json);
    const checkpoint = row.checkpoint_value && /^\d{4}-\d{2}-\d{2}$/.test(String(row.checkpoint_value))
      ? String(row.checkpoint_value)
      : to;
    const anchor = checkpoint < to ? checkpoint : to;
    const from = subtractDays(anchor, lookbackDays(config) - 1);

    return performanceIngestionService.run({
      datasetId: dataset.id,
      mode: "publish",
      triggerType: "retry",
      from,
      to,
      requestedBy: userId,
    });
  },
};
