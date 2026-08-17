/**
 * Export the active employees missing a cost centre and/or a process, as a CSV for
 * HR/Ops to complete.
 *
 * Both columns are here because both are unrecoverable and both block the same analysis.
 *
 *   cost centre  55 active employees. The rest were recovered from db_bill; these are the
 *                residue where no source holds a value, or two sources disagree and the
 *                choice is a business decision.
 *   process      341 active employees, including ALL 183 in the 0-30 day bucket. This one
 *                cannot be backfilled at all: attendance_daily_record yields 0 (it copies
 *                the employee's process at write time, so it is empty exactly when the
 *                employee is), break_daily_summary 0, db_bill.masjclrentry 0,
 *                db_bill.employee_master 1, ATS 1, roster 1. The value exists in nobody's
 *                system and has to be entered.
 *
 * Each row carries the valid options for that employee's branch so the sheet can be filled
 * without lookups, and so it is obvious that branch does NOT determine either field.
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

function envFile() {
  const p = path.resolve(__dirname, '..', '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const E = envFile();
const pick = (k, d) => process.env[k] || E[k] || d;
if (!pick('DB_USER') || !pick('DB_PASSWORD')) {
  console.error('DB_USER / DB_PASSWORD not found in environment or backend/.env');
  process.exit(1);
}

async function connectAny() {
  for (const host of [pick('DB_HOST', '192.168.10.6'), '122.184.128.90']) {
    try {
      const c = await mysql.createConnection({
        host, user: pick('DB_USER'), password: pick('DB_PASSWORD'),
        database: pick('DB_NAME', 'mas_hrms'), connectTimeout: 20000,
      });
      console.log(`connected via ${host}`);
      return c;
    } catch (e) { console.log(`${host} -> ${e.code}`); }
  }
  throw new Error('mas_hrms unreachable');
}

(async () => {
  const c = await connectAny();
  const [rows] = await c.query(`
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name,'UNASSIGNED') AS branch,
           COALESCE(d.dept_name,'')             AS department,
           COALESCE(des.designation_name,'')    AS designation,
           DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') AS date_of_joining,
           DATEDIFF(CURDATE(), e.date_of_joining)    AS aon_days,
           CASE WHEN DATEDIFF(CURDATE(), e.date_of_joining) <= 30 THEN '0-30'
                WHEN DATEDIFF(CURDATE(), e.date_of_joining) <= 60 THEN '31-60'
                WHEN DATEDIFF(CURDATE(), e.date_of_joining) <= 90 THEN '61-90'
                ELSE '90+' END                        AS aon_bucket,
           CASE WHEN e.cost_centre_id IS NULL THEN 'MISSING' ELSE 'ok' END AS cost_centre_status,
           CASE WHEN e.process_id     IS NULL THEN 'MISSING' ELSE 'ok' END AS process_status,
           ''  AS cost_centre_to_assign,
           ''  AS process_to_assign,
           (SELECT GROUP_CONCAT(cm.cost_centre_name ORDER BY cm.cost_centre_name SEPARATOR ' | ')
              FROM cost_centre_master cm WHERE cm.branch_id = e.branch_id AND cm.active_status = 1)
             AS valid_cost_centres_for_branch,
           (SELECT GROUP_CONCAT(pm.process_name ORDER BY pm.process_name SEPARATOR ' | ')
              FROM process_master pm WHERE pm.active_status = 1)
             AS valid_processes
      FROM employees e
      LEFT JOIN branch_master b        ON b.id   = e.branch_id
      LEFT JOIN department_master d    ON d.id   = e.department_id
      LEFT JOIN designation_master des ON des.id = e.designation_id
     WHERE e.active_status = 1
       AND (e.cost_centre_id IS NULL OR e.process_id IS NULL)
     ORDER BY aon_days ASC, branch, e.employee_code`);

  if (rows.length === 0) { console.log('nothing outstanding'); await c.end(); return; }

  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(k => esc(r[k])).join(','))).join('\r\n');

  const outDir = path.resolve(__dirname, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'org-assignment-worklist-for-hr.csv');
  fs.writeFileSync(out, csv, 'utf8');

  console.log(`wrote ${out}`);
  console.log(`rows: ${rows.length}`);
  const cc = rows.filter(r => r.cost_centre_status === 'MISSING').length;
  const pr = rows.filter(r => r.process_status === 'MISSING').length;
  console.log(`  missing cost centre: ${cc}`);
  console.log(`  missing process    : ${pr}`);
  const byBucket = {};
  for (const r of rows) byBucket[r.aon_bucket] = (byBucket[r.aon_bucket] || 0) + 1;
  console.log(`  by AON bucket: ${JSON.stringify(byBucket)}`);
  await c.end();
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
