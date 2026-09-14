/**
 * final-reconcile.mjs
 * Verifies all db_bill tables have been fully mirrored into mas_hrms.
 * Safe read-only script — no writes.
 */
import mysql from 'mysql2/promise';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}
function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}

const HRMS_HOST = arg('hrms-host', process.env.DB_HOST ?? fromEnvFile('DB_HOST') ?? '192.168.10.6');
const BILL_HOST = arg('bill-host', process.env.BILL_DB_HOST ?? fromEnvFile('BILL_DB_HOST') ?? '192.168.10.22');
const DB_USER   = process.env.DB_USER     ?? fromEnvFile('DB_USER');
const DB_PASS   = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD');

console.log(`Connecting HRMS=${HRMS_HOST}  db_bill=${BILL_HOST}`);

const hrms = await mysql.createConnection({
  host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'mas_hrms',
  connectTimeout: 30000
});
const bill = await mysql.createConnection({
  host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'db_bill',
  connectTimeout: 30000
});

const checks = [
  // [description, hrms_query, bill_query, note]
  ['bill_revenue_target_snapshot',   'SELECT COUNT(*) c FROM bill_revenue_target_snapshot',   'SELECT COUNT(*) c FROM dashboard_target_revenue', ''],
  ['bill_revenue_actual_snapshot',   'SELECT COUNT(*) c FROM bill_revenue_actual_snapshot',   'SELECT COUNT(*) c FROM dashboard_data_revenue', ''],
  ['employee_salary_history (migration)', "SELECT COUNT(*) c FROM employee_salary_history WHERE source='data_migration'", 'SELECT COUNT(*) c FROM his_masjsclrentry', '1149 employees not in HRMS'],
  ['legacy_salary_snapshot',         'SELECT COUNT(*) c FROM legacy_salary_snapshot',         'SELECT COUNT(*) c FROM masjclrentry', ''],
  ['od_register_snapshot',           'SELECT COUNT(*) c FROM od_register_snapshot',           'SELECT COUNT(*) c FROM od_apply_master', ''],
  ['employee_loans',                 'SELECT COUNT(*) c FROM employee_loans',                 'SELECT COUNT(*) c FROM LoanMaster', '39 legacy employees not in HRMS'],
  ['doc_legacy_snapshot',            'SELECT COUNT(*) c FROM doc_legacy_snapshot',            'SELECT COUNT(*) c FROM mas_docoments', ''],
  ['incometax_legacy_snapshot',      'SELECT COUNT(*) c FROM incometax_legacy_snapshot',      'SELECT COUNT(*) c FROM IncomtaxMaster', ''],
  ['change_doj_snapshot',            'SELECT COUNT(*) c FROM change_doj_snapshot',            'SELECT COUNT(*) c FROM ChangeDojMaster', ''],
  ['employee_move_snapshot',         'SELECT COUNT(*) c FROM employee_move_snapshot',         'SELECT COUNT(*) c FROM employee_move', ''],
  ['field_attendance_snapshot',      'SELECT COUNT(*) c FROM field_attendance_snapshot',      'SELECT COUNT(*) c FROM FieldAttandence', ''],
  ['qual_leave_snapshot',            'SELECT COUNT(*) c FROM qual_leave_snapshot',            'SELECT COUNT(*) c FROM qual_leave', ''],
  ['qual_attendance_snapshot',       'SELECT COUNT(*) c FROM qual_attendance_snapshot',       'SELECT COUNT(*) c FROM qual_attendance', ''],
  ['qual_salary_snapshot',           'SELECT COUNT(*) c FROM qual_salary_snapshot',           'SELECT COUNT(*) c FROM qual_salary', ''],
  ['salary_upload_snapshot',         'SELECT COUNT(*) c FROM salary_upload_snapshot',         'SELECT COUNT(*) c FROM salary_master_upload', ''],
  ['incentive_upload_snapshot',      'SELECT COUNT(*) c FROM incentive_upload_snapshot',      'SELECT COUNT(*) c FROM upload_incentive_breakup', ''],
  ['upload_deduction_snapshot',      'SELECT COUNT(*) c FROM upload_deduction_snapshot',      'SELECT COUNT(*) c FROM upload_deduction', ''],
  ['qual_incentive_snapshot',        'SELECT COUNT(*) c FROM qual_incentive_snapshot',        'SELECT COUNT(*) c FROM qual_incentive', ''],
  ['attendance (Attandence)',        "SELECT COUNT(*) c FROM attendance_legacy_snapshot WHERE source_table='Attandence'", 'SELECT COUNT(*) c FROM Attandence', '~368 added to db_bill after sync'],
  ['attendance (Attandence_old)',    "SELECT COUNT(*) c FROM attendance_legacy_snapshot WHERE source_table='Attandence_old'", 'SELECT COUNT(*) c FROM Attandence_old', ''],
  ['salary_prep_line (payroll)',     'SELECT COUNT(*) c FROM salary_prep_line',               'SELECT COUNT(*) c FROM salary_data', ''],
];

console.log('\n=== FINAL RECONCILIATION: db_bill ↔ mas_hrms ===\n');
console.log(String('Table').padEnd(48) + String('db_bill').padStart(10) + String('mas_hrms').padStart(10) + String('diff').padStart(8) + '  status');
console.log('─'.repeat(95));

let gapCount = 0;
for (const [desc, hq, bq, note] of checks) {
  try {
    const [[hr]] = await hrms.query(hq);
    const [[bl]] = await bill.query(bq);
    const hc = Number(hr.c), bc = Number(bl.c);
    const diff = hc - bc;
    let status;
    if (hc >= bc) {
      status = '✅ MATCH' + (diff > 0 ? ` (+${diff} extra)` : '');
    } else {
      status = `❌ GAP=${bc-hc}`;
      if (note) status += `  [${note}]`;
      gapCount++;
    }
    console.log(String(desc).padEnd(48) + String(bc).padStart(10) + String(hc).padStart(10) + String(diff>=0?`+${diff}`:diff).padStart(8) + '  ' + status);
  } catch (e) {
    console.log(String(desc).padEnd(48) + '  ERROR: ' + e.message.slice(0, 80));
    gapCount++;
  }
}

// Also check salary_prep_line_component coverage
const [[slc]] = await hrms.query('SELECT COUNT(*) c FROM salary_prep_line_component');
const [[bls]] = await bill.query('SELECT COUNT(*) c FROM salary_data');
console.log('─'.repeat(95));
console.log(String('salary_prep_line_component').padEnd(48) + String('N/A').padStart(10) + String(Number(slc.c)).padStart(10) + '          component rows: ' + Number(slc.c).toLocaleString());

console.log('\n' + '═'.repeat(95));
if (gapCount === 0) {
  console.log('✅  ALL TABLES MATCH — migration complete!');
} else {
  console.log(`⚠️   ${gapCount} gap(s) remain — see above.`);
}

await hrms.end();
await bill.end();
