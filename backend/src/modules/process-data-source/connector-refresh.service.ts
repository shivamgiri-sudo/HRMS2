import { randomUUID } from "node:crypto";
import type { Pool as MysqlPool } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { getPoolForKey, getCredentialsForKey } from "../external-db/external-db.service.js";
import { assertSafeIdentifier } from "../integration-hub/adapters/databaseAdapter.js";

/**
 * Pull one metric out of a client's own database and land it in
 * process_metric_actual.
 *
 * ── SQL injection surface, and how it is closed ─────────────────────────────
 * A table or column name cannot be a bound parameter, so a configurable source
 * unavoidably interpolates identifiers. Every one goes through
 * assertSafeIdentifier — the same guard KPI Studio's own connector reader and
 * integration-hub's database adapter use — and the aggregate is matched against
 * a fixed whitelist rather than passed through from the request. Dates are
 * bound. This mirrors the approach already documented in kpi-studio.sources.ts
 * rather than inventing a second, weaker one.
 *
 * ── Reads are read-only ────────────────────────────────────────────────────
 * This is another team's production database. The only statement issued here is
 * a SELECT, and external-db.service.ts's pools additionally enforce read-only
 * at the session level. Nothing here writes to a client's system.
 *
 * ── MySQL only, said out loud ──────────────────────────────────────────────
 * getPoolForKey returns MySQL or SQL Server, and the connector form offers
 * both. The query below is MySQL dialect throughout — backtick identifiers,
 * DATE_FORMAT, DATE_ADD — none of which is valid T-SQL. Rather than cast the
 * union and let an MSSQL connector fail deep inside the driver with an opaque
 * message (which is what the existing KPI Studio reader does), this refuses
 * MSSQL up front and names the reason. Supporting T-SQL means a second query
 * builder, which is a deliberate follow-up, not a silent gap.
 */

const AGGREGATES = ["SUM", "AVG", "COUNT", "MAX", "MIN"] as const;
export type ConnectorAggregate = (typeof AGGREGATES)[number];

export async function refreshConnectorMetric(input: {
  connectorKey: string;
  processId: string;
  metricKey: string;
  table: string;
  valueColumn: string;
  aggregate: ConnectorAggregate;
  dateColumn: string;
  from: string;
  to: string;
}): Promise<{ written: number }> {
  // Guards run before the pool is even opened, so a malformed mapping cannot
  // reach the client's database at all.
  assertSafeIdentifier(input.table);
  assertSafeIdentifier(input.valueColumn);
  assertSafeIdentifier(input.dateColumn);
  if (!AGGREGATES.includes(input.aggregate)) {
    throw new Error(`Unsupported aggregate: ${String(input.aggregate)}. Use one of ${AGGREGATES.join(", ")}.`);
  }

  const creds = await getCredentialsForKey(input.connectorKey);
  if (!creds) throw new Error(`No credentials configured for connector: ${input.connectorKey}`);
  if (creds.db_type === "mssql") {
    throw new Error(
      "SQL Server connectors are not supported for metric refresh yet — the query builder is MySQL dialect. Use a MySQL connector, or supply this metric by upload.",
    );
  }

  const pool = (await getPoolForKey(input.connectorKey)) as MysqlPool;

  // DATE_FORMAT, not DATE(): mysql2 hands back a bare DATE column as a JS Date
  // whose toString is "Fri Aug 01 2026 ...". Formatting in SQL keeps it the
  // string the upsert needs, and grouping by the same expression the SELECT
  // uses keeps sql_mode=only_full_group_by satisfied.
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(\`${input.dateColumn}\`, '%Y-%m-%d') AS d,
            ${input.aggregate}(\`${input.valueColumn}\`) AS v
       FROM \`${input.table}\`
      WHERE \`${input.dateColumn}\` >= ?
        AND \`${input.dateColumn}\` < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE_FORMAT(\`${input.dateColumn}\`, '%Y-%m-%d')
      ORDER BY d ASC`,
    [input.from, input.to],
  );

  const list = (rows as Array<{ d: string; v: string | number | null }>) ?? [];
  if (!list.length) return { written: 0 };

  const placeholders = list.map(() => "(?, ?, ?, ?, ?, 'connector', ?, NULL)").join(", ");
  const params: unknown[] = [];
  for (const row of list) {
    params.push(
      randomUUID(), input.processId, input.metricKey, row.d,
      row.v == null ? null : Number(row.v),
      input.connectorKey,
    );
  }

  await db.execute(
    `INSERT INTO process_metric_actual
       (id, process_id, metric_key, score_date, actual_value, source, source_connector_key, note)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       actual_value         = VALUES(actual_value),
       source               = 'connector',
       source_connector_key = VALUES(source_connector_key)`,
    params,
  );

  return { written: list.length };
}
