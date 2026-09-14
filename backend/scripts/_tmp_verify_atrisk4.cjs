require('dotenv').config({ path: __dirname + '/../.env' });
const mysql = require('mysql2/promise');

const AON_REF = "COALESCE(e.salary_start_date, e.date_of_joining)";

function aonBucketSql(asOf) {
  return `CASE
             WHEN DATEDIFF(${asOf}, ${AON_REF}) <= 30 THEN '0-30'
             WHEN DATEDIFF(${asOf}, ${AON_REF}) <= 60 THEN '31-60'
             WHEN DATEDIFF(${asOf}, ${AON_REF}) <= 90 THEN '61-90'
             ELSE '90+'
           END`;
}
function aonBucketOrderSql(asOf) {
  return `CASE
             WHEN DATEDIFF(${asOf}, ${AON_REF}) <= 30 THEN 1
             WHEN DATEDIFF(${asOf}, ${AON_REF}) <= 60 THEN 2
             WHEN DATEDIFF(${asOf}, ${AON_REF}) <= 90 THEN 3
             ELSE 4
           END`;
}
function atRiskBucketSql(asOf, joinDateCol) {
  return `CASE
             WHEN DATEDIFF(${asOf}, ${joinDateCol}) <= 30 THEN '0-30'
             WHEN DATEDIFF(${asOf}, ${joinDateCol}) <= 60 THEN '31-60'
             WHEN DATEDIFF(${asOf}, ${joinDateCol}) <= 90 THEN '61-90'
             ELSE '90+'
           END`;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const bucket = aonBucketSql("e.date_of_exit");
  const bucketOrder = aonBucketOrderSql("e.date_of_exit");

  const periodStartExpr = "STR_TO_DATE(CONCAT(g.month, '-01'), '%Y-%m-%d')";
  const periodEndExpr = "LAST_DAY(STR_TO_DATE(CONCAT(g.month, '-01'), '%Y-%m-%d'))";

  function atRiskCountSql(asOfExpr) {
    return `(
      SELECT COUNT(*) FROM at_risk ar
       WHERE ar.join_date <= ${asOfExpr}
         AND (ar.date_of_exit IS NULL OR ar.date_of_exit >= ${asOfExpr})
         AND (ar.branch_id <=> g.branch_id)
         AND (ar.process_id <=> g.process_id)
         AND (ar.cost_centre_id <=> g.cost_centre_id)
         AND ${atRiskBucketSql(asOfExpr, "ar.join_date")} = g.aon_bucket
    )`;
  }

  const atRiskAvgExpr = `((${atRiskCountSql(periodStartExpr)} + ${atRiskCountSql(periodEndExpr)}) / 2.0)`;

  const sql = `
    WITH at_risk AS (
      SELECT ${AON_REF} AS join_date, e.date_of_exit, e.branch_id, e.process_id, e.cost_centre_id
        FROM employees e
       WHERE ${AON_REF} IS NOT NULL
         AND (e.date_of_exit IS NULL OR e.date_of_exit >= e.date_of_joining)
    ),
    exit_groups AS (
      SELECT DATE_FORMAT(e.date_of_exit, '%Y-%m') AS month,
             e.branch_id, COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
             e.process_id, COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
             e.cost_centre_id,
             ${bucket} AS aon_bucket,
             COUNT(*) AS exits
        FROM employees e
        LEFT JOIN branch_master b  ON b.id = e.branch_id
        LEFT JOIN process_master p ON p.id = e.process_id
       WHERE e.date_of_exit IS NOT NULL
         AND e.date_of_joining IS NOT NULL
         AND e.date_of_exit >= e.date_of_joining
         AND e.date_of_exit BETWEEN '2026-06-01' AND '2026-06-30'
         AND e.branch_id = 'febd8777-6583-11f1-adb1-00155d0ab410'
       GROUP BY DATE_FORMAT(e.date_of_exit, '%Y-%m'), e.branch_id, b.branch_name,
                e.process_id, p.process_name, e.cost_centre_id, ${bucket}, ${bucketOrder}
    )
    SELECT g.month, g.branch_name, g.process_name, g.aon_bucket, g.exits,
           ROUND(${atRiskAvgExpr}, 1) AS at_risk_population_avg,
           ROUND(g.exits * 100.0 / NULLIF(${atRiskAvgExpr}, 0), 2) AS aon_attrition_rate_pct
      FROM exit_groups g
     ORDER BY g.month DESC, g.branch_name, g.process_name
  `;

  const [rows] = await conn.execute(sql);
  console.log('Restructured query result (per bucket, branch NOIDA-2, June 2026):');
  console.table(rows);
  console.log('Hand-verify expected for 0-30 bucket: at_risk_start=52, at_risk_end=103, avg=77.5, exits=86, rate=110.97%');

  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
