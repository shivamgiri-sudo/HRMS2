// SALES_COUNT for Bella-Vita/Neemans was re-pointed today (fix-sales-count-source.mjs,
// eb678c83) to the live AI-funnel "sold" signal, but the materialized values in
// process_metric_actual are still pre-fix (computed 2026-09-08, before the re-point) --
// every one of them reads 0.0000. computeStudioKpis() hung under this shared dev DB's
// load (same class of stall documented earlier this session for the Bella-Vita compute
// call), so this replicates the same field definition directly: COUNT(*) FROM
// db_masmis.magical_script_cache WHERE client_id=? AND sale_done=1, for the process's
// own most recent real call_date -- same "no backfill, per-process own latest date"
// discipline as every other one-off fix this session.
import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306, database: process.env.DB_NAME,
});

const PROCESSES = [
  { name: "Bella-Vita Organic", processId: "050b7ba8-67ba-11f1-adb1-00155d0ab410", clientId: "375" },
  { name: "Neemans Private Limited", processId: "05150ba3-67ba-11f1-adb1-00155d0ab410", clientId: "475" },
];

const results = [];
for (const p of PROCESSES) {
  // Plain MAX(call_date) picks up same-day stragglers (a single late-arriving
  // row with 0 calls scored) rather than the last actually-worked day -- caught
  // live: 2026-09-10 had exactly 1 row for Bella-Vita against a normal ~110-160/day
  // volume. Require at least 20 calls that day before treating it as real, same
  // spirit as the APR fallback-threshold pattern already used elsewhere.
  const [days] = await conn.query(
    `SELECT DATE_FORMAT(call_date, '%Y-%m-%d') d, COUNT(*) n
       FROM db_masmis.magical_script_cache
      WHERE client_id = ?
      GROUP BY DATE_FORMAT(call_date, '%Y-%m-%d')
      ORDER BY d DESC
      LIMIT 10`,
    [p.clientId],
  );
  const real = days.find((r) => Number(r.n) >= 20);
  const latest = real?.d ?? null;
  if (!latest) {
    results.push({ ...p, skipped: "no day with >=20 calls in the last 10 days of data" });
    continue;
  }

  const [[{ sold }]] = await conn.query(
    `SELECT COUNT(*) sold FROM db_masmis.magical_script_cache
      WHERE client_id = ? AND sale_done = 1
        AND call_date >= ? AND call_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    [p.clientId, latest, latest],
  );

  await conn.query(
    `INSERT INTO process_metric_actual
       (id, process_id, metric_key, score_date, actual_value, rollup_numerator, rollup_denominator,
        source, source_connector_key, note, created_by, created_at, updated_at)
     VALUES (UUID(), ?, 'SALES_COUNT', ?, ?, ?, NULL, 'connector', 'recompute-sales-count-direct',
             'Recomputed after SALES_COUNT was re-pointed to the live AI-funnel sold signal (eb678c83); process_metric_actual still held pre-fix zeros.',
             'demo-super-admin-id', NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       actual_value = VALUES(actual_value),
       rollup_numerator = VALUES(rollup_numerator),
       source = VALUES(source),
       source_connector_key = VALUES(source_connector_key),
       note = VALUES(note),
       updated_at = NOW()`,
    [p.processId, latest, sold, sold],
  );

  results.push({ ...p, scoreDate: latest, sold });
}

console.log(JSON.stringify(results, null, 2));
await conn.end();
