// One-off + re-runnable: applies the SAME quality-gate correction already
// shipped for QA_QUALITY_PCT (real bug, found and fixed earlier this
// session by comparing against Mydashboards) to its siblings that were
// missed -- every metric sourced from db_audit.call_quality_assessment
// that currently applies no "was this call actually audited" gate and no
// per-client "quality_percentage > 35" low-quality exclusion.
//
// Scope: each process's own latest real audited date, no historical
// rewrite -- same discipline as the QA_QUALITY_PCT fix.
import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306, database: process.env.DB_NAME,
});

const LOW_QUALITY_GATE_CLIENT_IDS = new Set(["375", "409", "475"]);

// metric_code -> { column, kind }. kind 'ratio' = pass/scored blank-excluded
// ratio (the QA_* family, already-correct formula shape per the audit --
// only the gate was missing). 'notblank' = COUNT(col not blank)/COUNT(*)
// (COMPETITOR_MENTION_PCT, VOC_*_NEG_PCT). 'profanity' is handled specially.
const METRICS = [
  { code: "QA_EMPATHY_PCT", column: "express_empathy", kind: "ratio" },
  { code: "QA_CONCERN_PCT", column: "customer_concern_acknowledged", kind: "ratio" },
  { code: "QA_CONCERN_ACK_PCT", column: "customer_concern_acknowledged", kind: "ratio" },
  { code: "QA_ACCURACY_PCT", column: "correct_and_complete_information", kind: "ratio" },
  { code: "QA_INFO_ACCURACY_PCT", column: "correct_and_complete_information", kind: "ratio" },
  { code: "QA_PROBING_PCT", column: "accurate_issue_probing", kind: "ratio" },
  { code: "QA_CLOSURE_PCT", column: "proper_call_closure", kind: "ratio" },
  { code: "QA_LISTENING_PCT", column: "active_listening", kind: "ratio" },
  { code: "COMPETITOR_MENTION_PCT", column: "Competitor_Name", kind: "notblank" },
  { code: "VOC_LOGISTICS_NEG_PCT", column: "customer_voc_logistic_negative", kind: "notblank" },
  { code: "VOC_PRODUCT_NEG_PCT", column: "customer_voc_product_negative", kind: "notblank" },
];

async function computeAndWrite(metric, processId, processName) {
  const [emps] = await conn.query(
    "SELECT employee_code FROM employees WHERE process_id = ?", [processId]
  );
  const codes = emps.map((e) => e.employee_code);
  if (!codes.length) return { code: metric.code, processName, skipped: "no employees" };
  const inList = codes.map(() => "?").join(",");

  const [latestRows] = await conn.query(
    `SELECT DATE_FORMAT(MAX(CallDate), '%Y-%m-%d') latest FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
    codes,
  );
  const dateIso = latestRows[0]?.latest;
  if (!dateIso) return { code: metric.code, processName, skipped: "no audited calls in the last 7 days" };

  const [cidRows] = await conn.query(
    `SELECT ClientId, COUNT(*) n FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY ClientId ORDER BY n DESC LIMIT 1`,
    [...codes, dateIso, dateIso],
  );
  if (!cidRows.length) return { code: metric.code, processName, skipped: "no audited calls that day (race)" };
  const clientId = String(cidRows[0].ClientId);
  const gateApplies = LOW_QUALITY_GATE_CLIENT_IDS.has(clientId);
  const gateClause = gateApplies ? "AND quality_percentage > 35" : "";

  let scoreSql;
  if (metric.kind === "ratio") {
    scoreSql = `ROUND(100.0 * SUM(CASE WHEN \`${metric.column}\` IS NOT NULL THEN IF(\`${metric.column}\`=1,1,0) ELSE 0 END)
                        / NULLIF(SUM(CASE WHEN \`${metric.column}\` IS NOT NULL THEN 1 ELSE 0 END), 0), 1)`;
  } else {
    scoreSql = `ROUND(100.0 * SUM(CASE WHEN \`${metric.column}\` IS NOT NULL AND TRIM(\`${metric.column}\`) != '' THEN 1 ELSE 0 END)
                        / COUNT(*), 1)`;
  }

  const [scoreRows] = await conn.query(
    `SELECT ${scoreSql} AS score, COUNT(*) AS n
       FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND quality_percentage IS NOT NULL ${gateClause}`,
    [...codes, dateIso, dateIso],
  );
  const score = scoreRows[0].score;
  const n = scoreRows[0].n;
  if (score === null || n === 0) return { code: metric.code, processName, clientId, skipped: "no scoreable calls after gate" };

  await conn.query(
    `INSERT INTO process_metric_actual (id, process_id, metric_key, score_date, actual_value, source, note, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, ?, 'connector', 'Corrected: added quality_percentage IS NOT NULL + per-client low-quality gate, same fix class already shipped for QA_QUALITY_PCT (Mydashboards-validated)', NOW(), NOW())
     ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), note = VALUES(note), updated_at = NOW()`,
    [processId, metric.code, dateIso, score],
  );
  return { code: metric.code, processName, clientId, gateApplies, date: dateIso, n, score };
}

const results = [];
for (const metric of METRICS) {
  const [procs] = await conn.query(
    `SELECT DISTINCT d.process_id, p.process_name
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
       JOIN process_master p ON p.id = d.process_id
      WHERE m.metric_code = ? AND d.active_status = 1`,
    [metric.code],
  );
  for (const proc of procs) {
    const r = await computeAndWrite(metric, proc.process_id, proc.process_name);
    results.push(r);
  }
}

console.log(JSON.stringify(results, null, 2));
const written = results.filter((r) => r.score !== undefined);
console.log(`\n${written.length} readings corrected across ${new Set(written.map((r) => r.processName)).size} processes.`);
await conn.end();
