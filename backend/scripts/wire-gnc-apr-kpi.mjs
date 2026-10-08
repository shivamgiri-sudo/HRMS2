// Wires the newly-built GNC APR bulk-upload table (gnc_apr_daily_actual,
// sql/1736) into KPI Studio so uploaded data actually reflects on the
// Process Operations dashboard -- GNC's real gap: it already has AHT
// (dialer_db.cdr_in_4) and OUTBOUND_CONNECT_PCT (db_masmis.gnc_allocation)
// live from other sources, but has NO source for AGENT_OCCUPANCY_PCT or
// AGENT_UTILISATION_PCT. Same formula shape already proven live for
// Bella-Vita Organic: occupancy = (talk+dispo)/(talk+dispo+wait),
// utilisation = (talk+dispo+wait)/(talk+dispo+wait+pause).
import mysql from "mysql2/promise";
import { randomUUID } from "crypto";
import "dotenv/config";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306, database: process.env.DB_NAME,
});

const GNC_PROCESS_ID = "05073ef4-67ba-11f1-adb1-00155d0ab410";
const dataSourceId = randomUUID();

await conn.query(
  `INSERT INTO kpi_studio_data_source
     (id, source_code, source_name, source_type, source_object, employee_key_column, employee_key_kind,
      date_column, description, active_status, created_by, process_key_kind, process_key_column,
      process_key_value, process_id)
   VALUES (?, 'GNC_APR', 'GNC — daily APR actuals', 'local_query', 'gnc_apr_daily_actual', NULL, 'employee_code',
      'report_date', 'Manually-uploaded GNC Agent Productivity Report (sql/1736) -- same report shape Mydashboards writes to db_masmis.gnc_apr, stale since 2026-05-30.',
      1, 'demo-super-admin-id', 'column', 'process_id', ?, ?)`,
  [dataSourceId, GNC_PROCESS_ID, GNC_PROCESS_ID],
);
console.log("data source created:", dataSourceId);

const fields = [
  { name: "talk_sec", column: "talk_seconds", fn: "SUM" },
  { name: "dispo_sec", column: "dispo_seconds", fn: "SUM" },
  { name: "wait_sec", column: "wait_seconds", fn: "SUM" },
  { name: "pause_sec", column: "pause_seconds", fn: "SUM" },
];
for (const f of fields) {
  await conn.query(
    `INSERT INTO kpi_studio_source_field (id, data_source_id, field_name, source_column, aggregate_fn, active_status)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [randomUUID(), dataSourceId, f.name, f.column, f.fn],
  );
}
console.log("fields created:", fields.length);

const [metrics] = await conn.query(
  "SELECT id, metric_code FROM kpi_metric_master WHERE metric_code IN ('AGENT_OCCUPANCY_PCT','AGENT_UTILISATION_PCT')"
);
const byCode = Object.fromEntries(metrics.map((m) => [m.metric_code, m.id]));

const defs = [
  { code: "AGENT_OCCUPANCY_PCT", formula: "PCT(talk_sec + dispo_sec, talk_sec + dispo_sec + wait_sec)" },
  { code: "AGENT_UTILISATION_PCT", formula: "PCT(talk_sec + dispo_sec + wait_sec, talk_sec + dispo_sec + wait_sec + pause_sec)" },
];
for (const d of defs) {
  await conn.query(
    `INSERT INTO kpi_studio_definition
       (id, metric_id, grain, process_id, data_source_id, formula_expression, aggregation_method,
        scoring_type, target_source, effective_from, active_status, created_by)
     VALUES (?, ?, 'process', ?, ?, ?, 'sum', 'raw', 'none', CURDATE(), 1, 'demo-super-admin-id')`,
    [randomUUID(), byCode[d.code], GNC_PROCESS_ID, dataSourceId, d.formula],
  );
  console.log("definition created:", d.code);
}

await conn.end();
