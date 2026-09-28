// One-off + re-runnable script: computes the REAL quality score (Mydashboards'
// validated formula -- per-call blank-excluded parameter average, per-client
// low-quality gate, fatal-call exclusion) for every process whose
// QA_QUALITY_PCT definition uses the flawed total_score/max_score formula, and
// writes today's corrected reading into process_metric_actual.
//
// Scope: TODAY ONLY, deliberately -- this does not touch or rewrite any
// historical process_metric_actual row. Re-run this daily (manually, or wire
// it into a scheduled job) to keep today's reading correct going forward.
import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306, database: process.env.DB_NAME,
});

const CQ_PARAM_COLS = [
  "call_answered_within_5_seconds", "customer_concern_acknowledged", "professionalism_maintained",
  "assurance_or_appreciation_provided", "pronunciation_and_clarity", "enthusiasm_and_no_fumbling",
  "active_listening", "politeness_and_no_sarcasm", "proper_grammar", "accurate_issue_probing",
  "proper_hold_procedure", "proper_transfer_and_language", "dead_air_under_10_seconds",
  "case_escalated_correctly", "address_recorded_completely", "correct_and_complete_information",
  "upselling_or_offers_suggested", "further_assistance_offered", "proper_call_closure",
];
const CLOVIA_CLIENT_ID = "468";
const CQ_PARAM_COLS_CLOVIA = [...CQ_PARAM_COLS, "express_empathy"];
const LOW_QUALITY_GATE_CLIENT_IDS = new Set(["375", "409", "475"]);
const FATAL_PARAM_COLS = [
  "address_recorded_completely", "correct_and_complete_information", "case_escalated_correctly",
  "customer_concern_acknowledged", "proper_hold_procedure", "proper_transfer_and_language",
];

function scoreSqlFor(cols) {
  const num = cols.map((c) => `(CASE WHEN ${c} IS NOT NULL THEN IF(${c}=1,1,0) ELSE 0 END)`).join(" + ");
  const den = cols.map((c) => `(CASE WHEN ${c} IS NOT NULL THEN 1 ELSE 0 END)`).join(" + ");
  return `((${num}) / NULLIF((${den}), 0))`;
}
const fatalSql = `(${FATAL_PARAM_COLS.map((c) => `${c} = 0`).join(" AND ")})`;

const [procs] = await conn.query(
  `SELECT DISTINCT d.process_id, p.process_name
     FROM kpi_studio_definition d
     JOIN kpi_metric_master m ON m.id = d.metric_id
     JOIN process_master p ON p.id = d.process_id
    WHERE m.metric_code = 'QA_QUALITY_PCT' AND d.active_status = 1`
);

console.log(`Computing corrected QA_QUALITY_PCT (each process's own latest audited date, no historical rewrite) across ${procs.length} processes...`);
const results = [];

for (const proc of procs) {
  const [emps] = await conn.query(
    "SELECT employee_code FROM employees WHERE process_id = ?", [proc.process_id]
  );
  const codes = emps.map((e) => e.employee_code);
  if (!codes.length) { results.push({ ...proc, skipped: "no employees" }); continue; }
  const inList = codes.map(() => "?").join(",");

  // The audit pipeline lags hours behind the actual call -- "today" genuinely
  // has zero rows most of the day. Use this process's own most recent date
  // with real audited-call data (bounded to the last 7 days, so a long-dead
  // feed doesn't silently resurrect as "the latest"), not the calendar date.
  // DATE_FORMAT to a plain string, not a JS Date object -- mysql2 returns DATE
  // columns adjusted for local/UTC offset, and reconstructing a calendar date
  // from that Date object's getFullYear/getMonth/getDate silently lands on the
  // wrong day (same pitfall already found and fixed once this session for
  // shrinkage's score_date). A string never has this problem.
  const [latestRows] = await conn.query(
    `SELECT DATE_FORMAT(MAX(CallDate), '%Y-%m-%d') latest FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
    codes,
  );
  const todayIso = latestRows[0]?.latest;
  if (!todayIso) { results.push({ ...proc, skipped: "no audited calls in the last 7 days" }); continue; }

  // CallDate is DATETIME, not DATE -- exact equality against a bare date
  // string only matches exact midnight. Use a same-day range instead.
  const [cidRows] = await conn.query(
    `SELECT ClientId, COUNT(*) n FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY ClientId ORDER BY n DESC LIMIT 1`,
    [...codes, todayIso, todayIso],
  );
  if (!cidRows.length) { results.push({ ...proc, skipped: "no audited calls on its own latest date (race)" }); continue; }
  const clientId = String(cidRows[0].ClientId);
  const cols = clientId === CLOVIA_CLIENT_ID ? CQ_PARAM_COLS_CLOVIA : CQ_PARAM_COLS;
  const gateApplies = LOW_QUALITY_GATE_CLIENT_IDS.has(clientId);
  const gateClause = gateApplies ? "AND quality_percentage > 35" : "";

  const [scoreRows] = await conn.query(
    `SELECT ROUND(AVG(CASE WHEN NOT (${fatalSql}) THEN ${scoreSqlFor(cols)} END) * 100, 1) AS score,
            COUNT(*) AS n
       FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND quality_percentage IS NOT NULL ${gateClause}`,
    [...codes, todayIso, todayIso],
  );
  const score = scoreRows[0].score;
  const n = scoreRows[0].n;
  if (score === null || n === 0) { results.push({ ...proc, clientId, skipped: "no scoreable calls after gates" }); continue; }

  await conn.query(
    `INSERT INTO process_metric_actual (id, process_id, metric_key, score_date, actual_value, source, note, created_at, updated_at)
     VALUES (UUID(), ?, 'QA_QUALITY_PCT', ?, ?, 'connector', 'Corrected formula (Mydashboards-validated: per-call blank-excluded avg, low-quality gate, fatal exclusion) -- see hrms2-quality-score-formula-corrected memory', NOW(), NOW())
     ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), note = VALUES(note), updated_at = NOW()`,
    [proc.process_id, todayIso, score],
  );
  results.push({ ...proc, clientId, gateApplies, n, score });
}

console.log(JSON.stringify(results, null, 2));
await conn.end();
