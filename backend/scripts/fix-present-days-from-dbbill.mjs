/**
 * fix-present-days-from-dbbill.mjs
 *
 * Syncs exact EarnedDays from db_bill.salary_data into mas_hrms.salary_prep_line.present_days.
 * The migration rounded some 0.5 (half-day) values to integers. This restores them.
 * Only updates rows where present_days differs from db_bill EarnedDays by > 0.01.
 * Never touches gross_salary, net_salary, or any salary amount.
 *
 * Usage:
 *   node backend/scripts/fix-present-days-from-dbbill.mjs
 *   node backend/scripts/fix-present-days-from-dbbill.mjs --month=2026-06
 */
import mysql from 'mysql2/promise';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(n, fb) { return process.argv.find(a=>a.startsWith('--'+n+'='))?.split('=')[1] ?? fb; }
function fromEnv(k) {
  try { const e=fs.readFileSync(path.join(__dirname,'../.env'),'utf8'); return e.match(new RegExp('^'+k+'=(.*)$','m'))?.[1]?.replace(/^["']|["']$/g,'').trim()??null; } catch { return null; }
}

const BILL_HOST = arg('bill-host', fromEnv('BILL_DB_HOST') ?? '14.97.30.236');
const HRMS_HOST = arg('hrms-host', fromEnv('DB_HOST')      ?? '192.168.10.6');
const DB_USER   = fromEnv('DB_USER');
const DB_PASS   = fromEnv('DB_PASSWORD');
const MONTH     = arg('month', null); // null = all months

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }

async function main() {
  log(`bill=${BILL_HOST}  hrms=${HRMS_HOST}${MONTH ? '  month='+MONTH : '  all months'}`);

  const bill = await mysql.createPool({ host:BILL_HOST, port:3306, user:DB_USER, password:DB_PASS, database:'db_bill', connectTimeout:30000, waitForConnections:true, connectionLimit:3, dateStrings:true });
  const hrms = await mysql.createPool({ host:HRMS_HOST, port:3306, user:DB_USER, password:DB_PASS, database:'mas_hrms', connectTimeout:30000, waitForConnections:true, connectionLimit:5 });

  // Get months to fix
  const monthCond = MONTH ? `AND DATE_FORMAT(SalayDate,'%Y-%m')='${MONTH}'` : '';
  const [months] = await bill.query(`SELECT DISTINCT DATE_FORMAT(SalayDate,'%Y-%m') AS mon FROM salary_data WHERE EmpCode NOT LIKE 'IDC%' ${monthCond} ORDER BY mon`);
  log(`Months to process: ${months.length}`);

  let totalFixed = 0;

  for (const { mon } of months) {
    // Load db_bill EarnedDays for this month
    const [bRows] = await bill.query(`SELECT EmpCode, EarnedDays FROM salary_data WHERE DATE_FORMAT(SalayDate,'%Y-%m')=? AND EmpCode NOT LIKE 'IDC%' AND (Status='1' OR Status IS NULL OR Status='' OR Status='0')`, [mon]);
    const bMap = new Map(bRows.map(r=>[r.EmpCode, Number(r.EarnedDays)]));

    // Load HRMS present_days for this month
    const [hRows] = await hrms.query(`SELECT spl.id, spl.employee_code, spl.present_days FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id=spl.run_id WHERE spr.run_month=?`, [mon]);

    let monthFixed = 0;
    for (const h of hRows) {
      const bDays = bMap.get(h.employee_code);
      if (bDays === undefined) continue;
      const hDays = Number(h.present_days);
      if (Math.abs(bDays - hDays) > 0.01) {
        await hrms.query('UPDATE salary_prep_line SET present_days=? WHERE id=?', [bDays, h.id]);
        monthFixed++;
      }
    }
    if (monthFixed > 0) { log(`  ${mon}: fixed ${monthFixed} rows`); totalFixed += monthFixed; }
  }

  log(`\nTotal rows fixed: ${totalFixed}`);
  await bill.end(); await hrms.end();
}
main().catch(e=>{ console.error('FATAL:', e.message); process.exit(1); });
