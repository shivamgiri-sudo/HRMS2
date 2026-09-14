require('dotenv').config({ path: __dirname + '/../.env' });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // 1. Find a real branch/month/bucket combo with a decent number of exits, from the
  //    actual aonBucketAttrition bucket definition (AON = COALESCE(salary_start_date, date_of_joining)).
  const [rows] = await conn.execute(`
    SELECT b.branch_name, e.branch_id,
           DATE_FORMAT(e.date_of_exit, '%Y-%m') AS month,
           CASE
             WHEN DATEDIFF(e.date_of_exit, COALESCE(e.salary_start_date, e.date_of_joining)) <= 30 THEN '0-30'
             WHEN DATEDIFF(e.date_of_exit, COALESCE(e.salary_start_date, e.date_of_joining)) <= 60 THEN '31-60'
             WHEN DATEDIFF(e.date_of_exit, COALESCE(e.salary_start_date, e.date_of_joining)) <= 90 THEN '61-90'
             ELSE '90+'
           END AS aon_bucket,
           COUNT(*) AS exits
      FROM employees e
      LEFT JOIN branch_master b ON b.id = e.branch_id
     WHERE e.date_of_exit IS NOT NULL
       AND e.date_of_joining IS NOT NULL
       AND e.date_of_exit >= e.date_of_joining
       AND e.date_of_exit BETWEEN '2025-08-01' AND '2026-08-25'
       AND e.branch_id IS NOT NULL
     GROUP BY b.branch_name, e.branch_id, month, aon_bucket
     ORDER BY exits DESC
     LIMIT 5
  `);
  console.log('Top bucket/branch/month combos by exit count:');
  console.table(rows);

  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
