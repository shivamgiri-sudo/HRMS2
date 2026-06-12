// backend/src/modules/apr/apr.service.ts
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getAprPool } from '../../db/aprDb.js';

const DEFAULT_TABLES = [
  'vicidial_agent_log_10_25',
  'vicidial_agent_log_10_4',
  'vicidial_agent_log_11_4',
  'vicidial_agent_log_11_5',
  'vicidial_agent_log_247',
  'vicidial_agent_log_249',
  'vicidial_agent_log_250',
  'vicidial_agent_log_9',
];

async function getAprConfig(): Promise<{
  tables: string[];
  date_column: string;
  employee_code_column: string;
  configured: boolean;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_json, encrypted_credentials FROM integration_config WHERE integration_key = 'apr_productivity'`
  );
  const row = (rows as any[])[0];
  if (!row || !row.encrypted_credentials) {
    return { tables: DEFAULT_TABLES, date_column: 'event_time', employee_code_column: 'agent_user', configured: false };
  }
  const config = row.config_json ?? {};
  return {
    tables: config.tables?.length ? config.tables : DEFAULT_TABLES,
    date_column: config.date_column ?? 'event_time',
    employee_code_column: config.employee_code_column ?? 'agent_user',
    configured: true,
  };
}

export async function getAprData(params: {
  date: string;
  employeeCode?: string;
  isManager: boolean;
}): Promise<{ configured: boolean; rows: any[] }> {
  const config = await getAprConfig();
  if (!config.configured) return { configured: false, rows: [] };

  const pool = await getAprPool();

  const unionParts = config.tables.map(
    t => `SELECT *, '${t}' AS _source_table FROM \`${t}\``
  );
  const unionSql = unionParts.join(' UNION ALL ');

  const whereClauses = [`DATE(\`${config.date_column}\`) = ?`];
  const queryParams: unknown[] = [params.date];

  if (!params.isManager && params.employeeCode) {
    whereClauses.push(`\`${config.employee_code_column}\` = ?`);
    queryParams.push(params.employeeCode);
  }

  const finalSql = `
    SELECT
      \`${config.employee_code_column}\` AS agent_user,
      SUM(login_time) AS login_time,
      SUM(talk_time) AS talk_time,
      SUM(pause_time) AS pause_time,
      SUM(wait_time) AS wait_time,
      SUM(dispo_time) AS dispo_time,
      SUM(dead_time) AS dead_time,
      SUM(calls) AS calls,
      CASE WHEN SUM(calls) > 0
        THEN ROUND((SUM(talk_time) + SUM(dispo_time)) / SUM(calls), 1)
        ELSE 0
      END AS aht_seconds
    FROM (${unionSql}) AS combined
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY \`${config.employee_code_column}\`
    ORDER BY \`${config.employee_code_column}\`
  `;

  const [rows] = await pool.execute(finalSql, queryParams as any);
  return { configured: true, rows: rows as any[] };
}
