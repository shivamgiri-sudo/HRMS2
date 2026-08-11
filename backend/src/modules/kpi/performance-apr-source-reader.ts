import type { Pool } from 'mysql2/promise';

export type AprSourceAggregate = {
  agent_user: string | null;
  total_talk: number;
  total_dispo: number;
  total_calls: number;
  source_records: number;
};

export type AprSourceReadResult = {
  rows: AprSourceAggregate[];
  errors: string[];
};

export const APR_DIALER_AGENT_LOG_TABLES = [
  'vicidial_agent_log_10_25',
  'vicidial_agent_log_10_4',
  'vicidial_agent_log_11_4',
  'vicidial_agent_log_11_5',
  'vicidial_agent_log_247',
  'vicidial_agent_log_249',
  'vicidial_agent_log_250',
  'vicidial_agent_log_9',
] as const;

const DEFAULT_TABLE_TIMEOUT_MS = 15_000;
const MAX_TABLE_TIMEOUT_MS = 30_000;
const SAFE_TABLE_NAME = /^[A-Za-z0-9_]+$/;

function numberValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function resolveTableTimeoutMs(): number {
  const configured = Number(process.env.PERFORMANCE_APR_TABLE_TIMEOUT_MS ?? DEFAULT_TABLE_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TABLE_TIMEOUT_MS;
  return Math.min(Math.floor(configured), MAX_TABLE_TIMEOUT_MS);
}

export function aprSourceReadBudgetMs(): number {
  return resolveTableTimeoutMs() + 1_000;
}

function resolveAprTables(): string[] {
  const configured = process.env.PERFORMANCE_APR_SOURCE_TABLES
    ?.split(',')
    .map((table) => table.trim())
    .filter(Boolean);
  const tables = configured?.length ? configured : [...APR_DIALER_AGENT_LOG_TABLES];
  const unsafe = tables.filter((table) => !SAFE_TABLE_NAME.test(table));
  if (unsafe.length) throw new Error(`Unsafe APR source table name(s): ${unsafe.join(', ')}`);
  return [...new Set(tables)];
}

async function withClientTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mergeRows(rows: AprSourceAggregate[]): AprSourceAggregate[] {
  const merged = new Map<string, AprSourceAggregate>();
  for (const row of rows) {
    const agent = normalizeIdentifier(row.agent_user);
    if (!agent) continue;
    const existing = merged.get(agent) ?? {
      agent_user: agent,
      total_talk: 0,
      total_dispo: 0,
      total_calls: 0,
      source_records: 0,
    };
    existing.total_talk += numberValue(row.total_talk);
    existing.total_dispo += numberValue(row.total_dispo);
    existing.total_calls += numberValue(row.total_calls);
    existing.source_records += numberValue(row.source_records);
    merged.set(agent, existing);
  }
  return [...merged.values()];
}

async function readAprTable(
  pool: Pool,
  table: string,
  date: string,
  timeoutMs: number,
): Promise<AprSourceReadResult> {
  try {
    const [rows] = await withClientTimeout(
      pool.execute(
        `SELECT /*+ MAX_EXECUTION_TIME(${timeoutMs}) */
                UPPER(TRIM(\`user\`)) AS agent_user,
                SUM(COALESCE(talk_sec, 0)) AS total_talk,
                SUM(COALESCE(dispo_sec, 0)) AS total_dispo,
                COUNT(*) AS total_calls,
                COUNT(*) AS source_records
           FROM \`${table}\`
          WHERE event_time >= ? AND event_time < ?
            AND \`user\` NOT IN ('VDAD', 'VDCL')
          GROUP BY UPPER(TRIM(\`user\`))`,
        [date, nextDate(date)],
      ) as Promise<[unknown, unknown]>,
      timeoutMs + 500,
      `APR ${table} query`,
    );
    return { rows: rows as AprSourceAggregate[], errors: [] };
  } catch (error) {
    return { rows: [], errors: [`${table}: ${errorMessage(error)}`] };
  }
}

export async function readAprSourceAggregates(pool: Pool, date: string): Promise<AprSourceReadResult> {
  const timeoutMs = resolveTableTimeoutMs();
  const results = await Promise.all(resolveAprTables().map((table) => readAprTable(pool, table, date, timeoutMs)));
  return {
    rows: mergeRows(results.flatMap((result) => result.rows)),
    errors: results.flatMap((result) => result.errors),
  };
}
