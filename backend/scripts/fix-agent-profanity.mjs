// AGENT_PROFANITY_PCT was undercounting ~52x: only checked
// agent_english_cuss_count > 0. Mydashboards' cuss_abuse_count
// (inbound-quality.service.ts:612-617) sums all four columns -- agent AND
// customer, English AND Hindi -- and flags the call if ANY is > 0. The
// declarative KPI Studio field-filter engine only ANDs filters together, so
// this OR-across-4-columns can't be expressed as a field filter; computed
// directly here instead, same pattern as fix-quality-gate-metrics.mjs.
// Same audited + per-client low-quality gate as every other CALL_AUDIT_SHARED
// metric. Scope: each process's own latest real audited date, no historical
// rewrite.
import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306, database: process.env.DB_NAME,
});

const LOW_QUALITY_GATE_CLIENT_IDS = new Set(["375", "409", "475"]);
const CUSS_COLS = [
  "agent_english_cuss_count", "agent_hindi_cuss_count",
  "customer_english_cuss_count", "customer_hindi_cuss_count",
];
const anyCussSql = CUSS_COLS.map((c) => `COALESCE(\`${c}\`,0)`).join(" + ") + " > 0";

const [procs] = await conn.query(
  `SELECT DISTINCT d.process_id, p.process_name
     FROM kpi_studio_definition d
     JOIN kpi_metric_master m ON m.id = d.metric_id
     JOIN process_master p ON p.id = d.process_id
    WHERE m.metric_code = 'AGENT_PROFANITY_PCT' AND d.active_status = 1`
);

const results = [];
for (const proc of procs) {
  const [emps] = await conn.query(
    "SELECT employee_code FROM employees WHERE process_id = ?", [proc.process_id]
  );
  const codes = emps.map((e) => e.employee_code);
  if (!codes.length) { results.push({ processName: proc.process_name, skipped: "no employees" }); continue; }
  const inList = codes.map(() => "?").join(",");

  const [latestRows] = await conn.query(
    `SELECT DATE_FORMAT(MAX(CallDate), '%Y-%m-%d') latest FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
    codes,
  );
  const dateIso = latestRows[0]?.latest;
  if (!dateIso) { results.push({ processName: proc.process_name, skipped: "no audited calls in the last 7 days" }); continue; }

  const [cidRows] = await conn.query(
    `SELECT ClientId, COUNT(*) n FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY ClientId ORDER BY n DESC LIMIT 1`,
    [...codes, dateIso, dateIso],
  );
  if (!cidRows.length) { results.push({ processName: proc.process_name, skipped: "no audited calls that day (race)" }); continue; }
  const clientId = String(cidRows[0].ClientId);
  const gateApplies = LOW_QUALITY_GATE_CLIENT_IDS.has(clientId);
  const gateClause = gateApplies ? "AND quality_percentage > 35" : "";

  const [scoreRows] = await conn.query(
    `SELECT ROUND(100.0 * SUM(CASE WHEN ${anyCussSql} THEN 1 ELSE 0 END) / COUNT(*), 2) AS score, COUNT(*) AS n
       FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND quality_percentage IS NOT NULL ${gateClause}`,
    [...codes, dateIso, dateIso],
  );
  const score = scoreRows[0].score;
  const n = scoreRows[0].n;
  if (score === null || n === 0) { results.push({ processName: proc.process_name, clientId, skipped: "no scoreable calls after gate" }); continue; }

  await conn.query(
    `INSERT INTO process_metric_actual (id, process_id, metric_key, score_date, actual_value, source, note, created_at, updated_at)
     VALUES (UUID(), ?, 'AGENT_PROFANITY_PCT', ?, ?, 'connector', 'Corrected: now sums agent+customer, English+Hindi cuss columns (was agent-English only, ~52x undercounted) -- Mydashboards-validated cuss_abuse_count logic', NOW(), NOW())
     ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), note = VALUES(note), updated_at = NOW()`,
    [proc.process_id, dateIso, score],
  );
  results.push({ processName: proc.process_name, clientId, gateApplies, date: dateIso, n, score });
}

console.log(JSON.stringify(results, null, 2));
await conn.end();
