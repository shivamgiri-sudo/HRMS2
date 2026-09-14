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

  const branchId = 'febd8777-6583-11f1-adb1-00155d0ab410'; // NOIDA-2
  const bucketMin = 0, bucketMax = 30; // '0-30' bucket
  const periodStart = '2026-06-01';
  const periodEnd = '2026-06-30'; // LAST_DAY('2026-06-01')

  // Hand-verification query (brief's Step 3, adapted): at-risk count at period START,
  // for this exact branch + bucket.
  const q = (asOf) => `
    SELECT COUNT(*) AS at_risk FROM employees e
     WHERE COALESCE(e.salary_start_date, e.date_of_joining) IS NOT NULL
       AND e.branch_id = ?
       AND COALESCE(e.salary_start_date, e.date_of_joining) <= ?
       AND (e.date_of_exit IS NULL OR e.date_of_exit >= ?)
       AND DATEDIFF(?, COALESCE(e.salary_start_date, e.date_of_joining)) BETWEEN ? AND ?
  `;

  const [startRows] = await conn.execute(q(periodStart), [branchId, periodStart, periodStart, periodStart, bucketMin, bucketMax]);
  const [endRows] = await conn.execute(q(periodEnd), [branchId, periodEnd, periodEnd, periodEnd, bucketMin, bucketMax]);

  console.log('Hand-verify: branch NOIDA-2, bucket 0-30, month 2026-06');
  console.log('  at_risk @ period start (2026-06-01):', startRows[0].at_risk);
  console.log('  at_risk @ period end   (2026-06-30):', endRows[0].at_risk);
  console.log('  avg (my formula):', (startRows[0].at_risk + endRows[0].at_risk) / 2);

  // Known exits in this group/bucket/month, for context.
  const [exitRows] = await conn.execute(`
    SELECT COUNT(*) AS exits FROM employees e
     WHERE e.date_of_exit IS NOT NULL AND e.date_of_joining IS NOT NULL
       AND e.date_of_exit >= e.date_of_joining
       AND e.branch_id = ?
       AND e.date_of_exit BETWEEN '2026-06-01' AND '2026-06-30'
       AND DATEDIFF(e.date_of_exit, COALESCE(e.salary_start_date, e.date_of_joining)) BETWEEN ? AND ?
  `, [branchId, bucketMin, bucketMax]);
  console.log('  exits in bucket/branch/month:', exitRows[0].exits);
  console.log('  implied attrition rate %:', (exitRows[0].exits / ((startRows[0].at_risk + endRows[0].at_risk) / 2) * 100).toFixed(2));

  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
