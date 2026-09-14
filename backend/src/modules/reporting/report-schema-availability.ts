import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

const CORE_REPORTING_TABLES = [
  'report_request',
  'report_email_delivery',
  'report_generated_file',
] as const;

const CACHE_TTL_MS = 60_000;

type ReportingSchemaStatus = {
  available: boolean;
  missingTables: string[];
  checkedAt: number;
};

let cachedStatus: ReportingSchemaStatus | null = null;

async function readReportingSchemaStatus(): Promise<ReportingSchemaStatus> {
  const placeholders = CORE_REPORTING_TABLES.map(() => '?').join(', ');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders})`,
    [...CORE_REPORTING_TABLES],
  );

  // MySQL information_schema returns TABLE_NAME (uppercase) on some servers — handle both
  const present = new Set(rows.map((row) => {
    const r = row as Record<string, unknown>;
    return String(r['table_name'] ?? r['TABLE_NAME'] ?? '').toLowerCase();
  }));
  const missingTables = CORE_REPORTING_TABLES.filter((tableName) => !present.has(tableName.toLowerCase()));

  return {
    available: missingTables.length === 0,
    missingTables: [...missingTables],
    checkedAt: Date.now(),
  };
}

export async function getReportingSchemaStatus(forceRefresh = false): Promise<ReportingSchemaStatus> {
  if (!forceRefresh && cachedStatus && Date.now() - cachedStatus.checkedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }

  cachedStatus = await readReportingSchemaStatus();
  return cachedStatus;
}

export async function ensureReportingSchemaAvailable(): Promise<void> {
  const status = await getReportingSchemaStatus();
  if (status.available) return;

  throw Object.assign(
    new Error(
      `Report request feature is temporarily unavailable because the reporting schema is not migrated on this server (${status.missingTables.join(', ')}).`,
    ),
    {
      statusCode: 503,
      code: 'REPORTING_SCHEMA_MISSING',
      missingTables: status.missingTables,
    },
  );
}
