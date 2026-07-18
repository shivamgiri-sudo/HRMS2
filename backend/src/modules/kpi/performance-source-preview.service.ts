import { db } from '../../db/mysql.js';
import { getPoolForKey } from '../external-db/external-db.service.js';
import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

export type PreviewMetric = {
  metricCode: string;
  value: number;
  numerator?: number;
  denominator?: number;
};

export type SourcePreview = {
  key: 'apr' | 'quality' | 'conversion' | 'salesBrandMis' | 'salesOrders';
  connectorKey: string;
  configured: boolean;
  active: boolean;
  hasCredentials: boolean;
  lastTestOk: boolean | null;
  ok: boolean;
  sourceRows: number;
  mappedRows: number;
  unmappedRows: number;
  metrics: PreviewMetric[];
  unmappedIdentifiers: string[];
  errors: string[];
};

export type PerformanceSourcePreview = {
  date: string;
  yearMonth: string;
  generatedAt: string;
  sources: {
    apr: SourcePreview;
    quality: SourcePreview;
    conversion: SourcePreview;
    salesBrandMis: SourcePreview;
    salesOrders: SourcePreview;
  };
};

type SourceRow = {
  agent_user: string | null;
  total_talk?: number | string | null;
  total_dispo?: number | string | null;
  total_calls?: number | string | null;
  points_earned?: number | string | null;
  points_possible?: number | string | null;
  fatal_audits?: number | string | null;
  total_audits?: number | string | null;
  converted_sales?: number | string | null;
  eligible_contacts?: number | string | null;
  revenue?: number | string | null;
  cod_orders?: number | string | null;
  rto_orders?: number | string | null;
  total_aht?: number | string | null;
  quality_points?: number | string | null;
  quality_denominator?: number | string | null;
};

type ConnectorStatus = {
  integration_key: string;
  active_status: number | string | null;
  has_credentials: number | string | null;
  test_ok: number | string | null;
  test_error: string | null;
};

const CONNECTORS = {
  apr: 'apr_productivity',
  quality: 'quality_audit',
  conversion: 'outbound_calls',
  salesBrandMis: 'sales_brand_mis',
  salesOrders: 'sales_brand_mis',
} as const;

function numberValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function monthBounds(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(year, month, 1));
  return { from: `${yearMonth}-01`, to: d.toISOString().slice(0, 10) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} preview query timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connectorStatuses(): Promise<Map<string, ConnectorStatus>> {
  const keys = Object.values(CONNECTORS);
  const placeholders = keys.map(() => '?').join(',');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT integration_key,
            active_status,
            CASE WHEN encrypted_credentials IS NULL OR encrypted_credentials = '' THEN 0 ELSE 1 END AS has_credentials,
            test_ok,
            test_error
       FROM integration_config
      WHERE integration_key IN (${placeholders})`,
    keys,
  );
  return new Map((rows as any[]).map((row) => [String(row.integration_key), row as ConnectorStatus]));
}

async function employeeMapFor(rows: SourceRow[]): Promise<Map<string, string>> {
  const identifiers = [...new Set(rows.map((row) => normalizeIdentifier(row.agent_user)).filter(Boolean))];
  if (!identifiers.length) return new Map();
  const placeholders = identifiers.map(() => '?').join(',');
  const [employeeRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, biometric_code
       FROM employees
      WHERE active_status = 1
        AND (UPPER(TRIM(employee_code)) IN (${placeholders})
             OR UPPER(TRIM(COALESCE(biometric_code, ''))) IN (${placeholders}))`,
    [...identifiers, ...identifiers],
  );
  const map = new Map<string, string>();
  for (const employee of employeeRows as any[]) {
    const employeeCode = normalizeIdentifier(employee.employee_code);
    const biometricCode = normalizeIdentifier(employee.biometric_code);
    if (employeeCode && !map.has(employeeCode)) map.set(employeeCode, String(employee.id));
    if (biometricCode && !map.has(biometricCode)) map.set(biometricCode, String(employee.id));
  }
  return map;
}

function emptyPreview(key: keyof typeof CONNECTORS, status?: ConnectorStatus): SourcePreview {
  return {
    key,
    connectorKey: CONNECTORS[key],
    configured: Boolean(status),
    active: Number(status?.active_status ?? 0) === 1,
    hasCredentials: Number(status?.has_credentials ?? 0) === 1,
    lastTestOk: status?.test_ok === null || status?.test_ok === undefined ? null : Number(status.test_ok) === 1,
    ok: false,
    sourceRows: 0,
    mappedRows: 0,
    unmappedRows: 0,
    metrics: [],
    unmappedIdentifiers: [],
    errors: status?.test_error ? [String(status.test_error)] : [],
  };
}

async function previewRows(
  key: keyof typeof CONNECTORS,
  statuses: Map<string, ConnectorStatus>,
  query: (pool: Pool) => Promise<SourceRow[]>,
  metricsFor: (row: SourceRow) => PreviewMetric[],
): Promise<SourcePreview> {
  const status = statuses.get(CONNECTORS[key]);
  const preview = emptyPreview(key, status);
  try {
    const pool = await getPoolForKey(CONNECTORS[key]) as Pool;
    const rows = await withTimeout(query(pool), 10_000, key);
    const employees = await employeeMapFor(rows);
    for (const row of rows) {
      const identifier = normalizeIdentifier(row.agent_user);
      if (!identifier || !employees.has(identifier)) {
        preview.unmappedRows += 1;
        if (identifier) preview.unmappedIdentifiers.push(identifier);
        continue;
      }
      preview.mappedRows += 1;
      preview.metrics.push(...metricsFor(row));
    }
    preview.ok = true;
    preview.sourceRows = rows.length;
    preview.unmappedIdentifiers = [...new Set(preview.unmappedIdentifiers)].slice(0, 25);
    return preview;
  } catch (error) {
    preview.errors.push(errorMessage(error));
    return preview;
  }
}

export async function previewPerformanceSources(input: { date: string; yearMonth?: string }): Promise<PerformanceSourcePreview> {
  const yearMonth = input.yearMonth ?? input.date.slice(0, 7);
  const statuses = await connectorStatuses();
  const bounds = monthBounds(yearMonth);

  const apr = await previewRows('apr', statuses, async (pool) => {
    const [rows] = await pool.execute(
      `SELECT UPPER(TRIM(user)) AS agent_user,
              SUM(COALESCE(talk_sec, 0)) AS total_talk,
              SUM(COALESCE(dispo_sec, 0)) AS total_dispo,
              COUNT(*) AS total_calls,
              COUNT(*) AS source_records
         FROM vw_agent_log_all
        WHERE event_time >= ? AND event_time < ?
        GROUP BY UPPER(TRIM(user))`,
      [input.date, nextDate(input.date)],
    );
    return rows as SourceRow[];
  }, (row) => {
    const calls = numberValue(row.total_calls);
    const talk = numberValue(row.total_talk);
    const dispo = numberValue(row.total_dispo);
    if (calls <= 0) return [];
    return [
      { metricCode: 'AHT', value: round1((talk + dispo) / calls), numerator: talk + dispo, denominator: calls },
      { metricCode: 'TALK_TIME', value: round1(talk / calls), numerator: talk, denominator: calls },
      { metricCode: 'DIALS', value: calls, numerator: calls },
      { metricCode: 'ACW', value: round1(dispo / calls), numerator: dispo, denominator: calls },
    ];
  });

  const quality = await previewRows('quality', statuses, async (pool) => {
    const [rows] = await pool.execute(
      `SELECT UPPER(TRIM(\`User\`)) AS agent_user,
              SUM(COALESCE(total_score, 0)) AS points_earned,
              SUM(COALESCE(max_score, 0)) AS points_possible,
              SUM(CASE WHEN quality_percentage = 0 THEN 1 ELSE 0 END) AS fatal_audits,
              COUNT(*) AS total_audits,
              DATE(MAX(CallDate)) AS last_audit_date
         FROM call_quality_assessment
        WHERE CallDate >= ? AND CallDate < ?
        GROUP BY UPPER(TRIM(\`User\`))`,
      [bounds.from, bounds.to],
    );
    return rows as SourceRow[];
  }, (row) => {
    const possible = numberValue(row.points_possible);
    const audits = numberValue(row.total_audits);
    const metrics: PreviewMetric[] = [];
    if (possible > 0) metrics.push({ metricCode: 'QUALITY_SCORE', value: round2((numberValue(row.points_earned) / possible) * 100), numerator: numberValue(row.points_earned), denominator: possible });
    if (audits > 0) metrics.push({ metricCode: 'FATAL_RATE', value: round2((numberValue(row.fatal_audits) / audits) * 100), numerator: numberValue(row.fatal_audits), denominator: audits });
    return metrics;
  });

  const conversion = await previewRows('conversion', statuses, async (pool) => {
    const [rows] = await pool.execute(
      `SELECT UPPER(TRIM(AgentName)) AS agent_user,
              SUM(CASE WHEN SaleDone = 1 THEN 1 ELSE 0 END) AS converted_sales,
              COUNT(*) AS eligible_contacts,
              COUNT(*) AS source_records
         FROM CallDetails
        WHERE CallDate >= ? AND CallDate < ?
        GROUP BY UPPER(TRIM(AgentName))`,
      [input.date, nextDate(input.date)],
    );
    return rows as SourceRow[];
  }, (row) => {
    const eligible = numberValue(row.eligible_contacts);
    if (eligible <= 0) return [];
    return [{ metricCode: 'CONVERSION_RATE', value: round2((numberValue(row.converted_sales) / eligible) * 100), numerator: numberValue(row.converted_sales), denominator: eligible }];
  });

  const salesBrandMis = await previewRows('salesBrandMis', statuses, async (pool) => {
    const [rows] = await pool.execute(
      `SELECT UPPER(TRIM(agent_user)) AS agent_user,
              SUM(total_calls) AS total_calls,
              0 AS converted_sales,
              SUM(total_aht) AS total_aht,
              SUM(total_talk) AS total_talk,
              SUM(total_dispo) AS total_dispo,
              0 AS quality_points,
              0 AS quality_denominator,
              SUM(source_records) AS source_records
         FROM (
           SELECT CONVERT(COALESCE(NULLIF(noiid, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
                  COALESCE(num_calls_chat, unique_count, 0) AS total_calls,
                  COALESCE(acht, 0) * COALESCE(num_calls_chat, unique_count, 0) AS total_aht,
                  CASE WHEN talk_time LIKE '%:%:%' THEN
                    CAST(SUBSTRING_INDEX(talk_time, ':', 1) AS UNSIGNED) * 3600
                    + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(talk_time, ':', 2), ':', -1) AS UNSIGNED) * 60
                    + CAST(SUBSTRING_INDEX(talk_time, ':', -1) AS UNSIGNED)
                  ELSE 0 END AS total_talk,
                  CASE WHEN dispo_time LIKE '%:%:%' THEN
                    CAST(SUBSTRING_INDEX(dispo_time, ':', 1) AS UNSIGNED) * 3600
                    + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(dispo_time, ':', 2), ':', -1) AS UNSIGNED) * 60
                    + CAST(SUBSTRING_INDEX(dispo_time, ':', -1) AS UNSIGNED)
                  ELSE 0 END AS total_dispo,
                  1 AS source_records
             FROM db_masmis.bb_apr
            WHERE report_date = ?
           UNION ALL
           SELECT CONVERT(COALESCE(NULLIF(emp_id, ''), user_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
                  COALESCE(calls, 0) AS total_calls,
                  COALESCE(acht, 0) * COALESCE(calls, 0) AS total_aht,
                  CASE WHEN talk_time LIKE '%:%:%' THEN
                    CAST(SUBSTRING_INDEX(talk_time, ':', 1) AS UNSIGNED) * 3600
                    + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(talk_time, ':', 2), ':', -1) AS UNSIGNED) * 60
                    + CAST(SUBSTRING_INDEX(talk_time, ':', -1) AS UNSIGNED)
                  ELSE 0 END AS total_talk,
                  CASE WHEN dispo_time LIKE '%:%:%' THEN
                    CAST(SUBSTRING_INDEX(dispo_time, ':', 1) AS UNSIGNED) * 3600
                    + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(dispo_time, ':', 2), ':', -1) AS UNSIGNED) * 60
                    + CAST(SUBSTRING_INDEX(dispo_time, ':', -1) AS UNSIGNED)
                  ELSE 0 END AS total_dispo,
                  1 AS source_records
             FROM db_masmis.gnc_apr
            WHERE report_date = ?
           UNION ALL
           SELECT CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
                  COALESCE(calls, 0) AS total_calls,
                  COALESCE(acht, 0) * COALESCE(calls, 0) AS total_aht,
                  CASE WHEN talk LIKE '%:%:%' THEN
                    CAST(SUBSTRING_INDEX(talk, ':', 1) AS UNSIGNED) * 3600
                    + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(talk, ':', 2), ':', -1) AS UNSIGNED) * 60
                    + CAST(SUBSTRING_INDEX(talk, ':', -1) AS UNSIGNED)
                  ELSE 0 END AS total_talk,
                  CASE WHEN dispo LIKE '%:%:%' THEN
                    CAST(SUBSTRING_INDEX(dispo, ':', 1) AS UNSIGNED) * 3600
                    + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(dispo, ':', 2), ':', -1) AS UNSIGNED) * 60
                    + CAST(SUBSTRING_INDEX(dispo, ':', -1) AS UNSIGNED)
                  ELSE 0 END AS total_dispo,
                  1 AS source_records
             FROM db_masmis.neemans_apr
            WHERE STR_TO_DATE(\`date\`, '%d-%b-%Y') = ?
         ) brand_apr
        GROUP BY UPPER(TRIM(agent_user))`,
      [input.date, input.date, input.date],
    );
    return rows as SourceRow[];
  }, (row) => {
    const calls = numberValue(row.total_calls);
    const metrics: PreviewMetric[] = [];
    if (calls > 0) {
      metrics.push(
        { metricCode: 'DIALS', value: calls, numerator: calls },
        { metricCode: 'AHT', value: round1(numberValue(row.total_aht) / calls), numerator: numberValue(row.total_aht), denominator: calls },
        { metricCode: 'TALK_TIME', value: round1(numberValue(row.total_talk) / calls), numerator: numberValue(row.total_talk), denominator: calls },
        { metricCode: 'ACW', value: round1(numberValue(row.total_dispo) / calls), numerator: numberValue(row.total_dispo), denominator: calls },
      );
    }
    return metrics;
  });

  const salesOrders = await previewRows('salesOrders', statuses, async (pool) => {
    const [rows] = await pool.execute(
      `SELECT UPPER(TRIM(agent_user)) AS agent_user,
              SUM(converted_sales) AS converted_sales,
              SUM(revenue) AS revenue,
              SUM(cod_orders) AS cod_orders,
              SUM(rto_orders) AS rto_orders,
              SUM(source_records) AS source_records
         FROM (
           SELECT CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
                  SUM(COALESCE(sale_count, 1)) AS converted_sales,
                  SUM(COALESCE(amount, 0)) AS revenue,
                  SUM(CASE WHEN UPPER(TRIM(payment_status)) = 'COD' THEN 1 ELSE 0 END) AS cod_orders,
                  SUM(CASE WHEN UPPER(CONCAT_WS(' ', current_status, final_status, rto_status)) LIKE '%RTO%' THEN 1 ELSE 0 END) AS rto_orders,
                  COUNT(*) AS source_records
             FROM db_masmis.bb_sale
            WHERE \`Date\` = ? OR \`Order Date\` = ? OR DATE(Order_DateTime) = ?
            GROUP BY CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
           UNION ALL
           SELECT CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
                  SUM(COALESCE(sale_count, 1)) AS converted_sales,
                  SUM(COALESCE(sum_before_gst, gross_amount, 0)) AS revenue,
                  SUM(CASE WHEN UPPER(TRIM(payment_status)) = 'COD' THEN 1 ELSE 0 END) AS cod_orders,
                  SUM(CASE WHEN UPPER(TRIM(status)) = 'RTO' THEN 1 ELSE 0 END) AS rto_orders,
                  COUNT(*) AS source_records
             FROM db_masmis.gnc_sale
            WHERE sale_date = ?
            GROUP BY CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
           UNION ALL
           SELECT CONVERT(COALESCE(NULLIF(emp_id, ''), name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
                  SUM(COALESCE(\`count\`, 1)) AS converted_sales,
                  SUM(COALESCE(amount, 0)) AS revenue,
                  SUM(CASE WHEN UPPER(TRIM(payment_status)) = 'COD' THEN 1 ELSE 0 END) AS cod_orders,
                  SUM(CASE WHEN UPPER(CONCAT_WS(' ', status, current_status, final_status)) LIKE '%RTO%' THEN 1 ELSE 0 END) AS rto_orders,
                  COUNT(*) AS source_records
             FROM db_masmis.neemans_sale_raw
            WHERE DATE_ADD('1899-12-30', INTERVAL CAST(\`date\` AS UNSIGNED) DAY) = ?
            GROUP BY CONVERT(COALESCE(NULLIF(emp_id, ''), name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
         ) brand_sales
        GROUP BY UPPER(TRIM(agent_user))`,
      [input.date, input.date, input.date, input.date, input.date],
    );
    return rows as SourceRow[];
  }, (row) => {
    const sales = numberValue(row.converted_sales);
    const revenue = numberValue(row.revenue);
    if (sales <= 0) return [];
    return [
      { metricCode: 'SALES_COUNT', value: sales, numerator: sales },
      { metricCode: 'REVENUE', value: round2(revenue), numerator: revenue },
      { metricCode: 'AOV', value: round2(revenue / sales), numerator: revenue, denominator: sales },
      { metricCode: 'COD_SHARE', value: round2((numberValue(row.cod_orders) / sales) * 100), numerator: numberValue(row.cod_orders), denominator: sales },
      { metricCode: 'RTO_RATE', value: round2((numberValue(row.rto_orders) / sales) * 100), numerator: numberValue(row.rto_orders), denominator: sales },
    ];
  });
  return {
    date: input.date,
    yearMonth,
    generatedAt: new Date().toISOString(),
    sources: { apr, quality, conversion, salesBrandMis, salesOrders },
  };
}
