/**
 * Export the employees still missing a cost centre, as a CSV for HR/Ops to complete.
 *
 * These are the rows the backfill deliberately would not guess: no cost centre in the
 * onboarding offer and none in db_bill, or two sources that disagree. Each row carries the
 * valid options for that employee's branch, so the sheet can be filled without looking
 * anything up — and so it is obvious that branch does NOT determine cost centre (NOIDA
 * alone offers dozens of choices).
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

/**
 * Credentials come from backend/.env, never from this file. Values there are wrapped in
 * double quotes and must be stripped, or they travel as part of the password.
 */
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

const CFG = { user: pick('DB_USER'), password: pick('DB_PASSWORD'), database: pick('DB_NAME', 'mas_hrms'), connectTimeout: 20000 };
const HOSTS = [pick('DB_HOST', '192.168.10.6'), '122.184.128.90'];

async function connectAny() {
  for (const host of HOSTS) {
    try { const c = await mysql.createConnection({ ...CFG, host }); console.log(`connected via ${host}`); return c; }
    catch (e) { console.log(`${host} -> ${e.code}`); }
  }
  throw new Error('mas_hrms unreachable');
}

(async () => {
  const c = await connectAny();
  const [rows] = await c.query(`
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name,'UNASSIGNED') AS branch,
           COALESCE(d.dept_name,'')            AS department,
           COALESCE(des.designation_name,'')   AS designation,
           DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') AS date_of_joining,
           ''                                  AS cost_centre_to_assign,
           (SELECT GROUP_CONCAT(cm.cost_centre_name ORDER BY cm.cost_centre_name SEPARATOR ' | ')
              FROM cost_centre_master cm
             WHERE cm.branch_id = e.branch_id AND cm.active_status = 1) AS valid_options_for_branch
      FROM employees e
      LEFT JOIN branch_master b        ON b.id   = e.branch_id
      LEFT JOIN department_master d    ON d.id   = e.department_id
      LEFT JOIN designation_master des ON des.id = e.designation_id
     WHERE e.active_status = 1
       AND e.cost_centre_id IS NULL
       AND e.date_of_joining >= '2026-07-20'
     ORDER BY branch, e.employee_code`);

  if (rows.length === 0) { console.log('nothing outstanding'); await c.end(); return; }

  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(k => esc(r[k])).join(','))).join('\r\n');

  const outDir = path.resolve(__dirname, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'cost-centre-worklist-for-hr.csv');
  fs.writeFileSync(out, csv, 'utf8');

  console.log(`wrote ${out}`);
  console.log(`rows: ${rows.length}`);
  const byBranch = {};
  for (const r of rows) byBranch[r.branch] = (byBranch[r.branch] || 0) + 1;
  console.log('by branch: ' + JSON.stringify(byBranch));
  console.log('choices available per branch: ' +
    JSON.stringify(rows.reduce((a, r) => {
      a[r.branch] = (r.valid_options_for_branch || '').split(' | ').filter(Boolean).length; return a;
    }, {})));
  await c.end();
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
