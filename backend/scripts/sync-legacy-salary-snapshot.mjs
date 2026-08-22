/**
 * sync-legacy-salary-snapshot.mjs
 *
 * Syncs ALL salary components from db_bill.masjclrentry into
 * mas_hrms.legacy_salary_snapshot using bulk INSERT … ON DUPLICATE KEY UPDATE.
 *
 * Usage:
 *   node backend/scripts/sync-legacy-salary-snapshot.mjs
 *   node backend/scripts/sync-legacy-salary-snapshot.mjs --bill-host=14.97.30.236 --hrms-host=122.184.128.90
 */
import mysql from 'mysql2/promise';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function arg(k, fb) { return process.argv.find(a=>a.startsWith('--'+k+'='))?.split('=')[1]??fb; }
function fromEnv(k) {
  try { const e=fs.readFileSync(path.join(__dirname,'../.env'),'utf8'); return e.match(new RegExp('^'+k+'=(.*)$','m'))?.[1]?.replace(/^["']|["']$/g,'').trim()??null; } catch { return null; }
}

const BILL_HOST = arg('bill-host', fromEnv('BILL_DB_HOST') ?? '14.97.30.236');
const HRMS_HOST = arg('hrms-host', fromEnv('DB_HOST')      ?? '122.184.128.90');
const DB_USER   = fromEnv('DB_USER');
const DB_PASS   = fromEnv('DB_PASSWORD');
const BATCH     = 200;

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }
function n(v)   { return v == null ? 0 : (Number(v)||0); }
function bool(v){ return (v==='1'||v===1) ? 1 : 0; }
function dt(v)  { return v && String(v).length>=10 ? String(v).substring(0,10) : null; }
function str(v) { return v ? String(v).trim() : null; }

async function main() {
  log(`bill=${BILL_HOST}  hrms=${HRMS_HOST}`);

  const bill = await mysql.createPool({ host:BILL_HOST, port:3306, user:DB_USER, password:DB_PASS, database:'db_bill',  connectTimeout:30000, waitForConnections:true, connectionLimit:3, dateStrings:true });
  const hrms = await mysql.createPool({ host:HRMS_HOST, port:3306, user:DB_USER, password:DB_PASS, database:'mas_hrms', connectTimeout:30000, waitForConnections:true, connectionLimit:5 });

  // 1. Load all masjclrentry rows keyed by UPPERCASE EmpCode
  log('Loading masjclrentry...');
  const [bRows] = await bill.query(`
    SELECT Id, EmpCode, EmpName, BranchName, Process, Desgination, DOJ, DOL,
           bs, hra, conv, da, ma, portf, sa, oa,
           EPF, EPFCO, ESIC, ESICCO, ProfessionalTax,
           Gross, NetInhand, CTC, pfelig, esielig
    FROM masjclrentry
  `);
  const bMap = new Map(bRows.map(r=>[r.EmpCode.toUpperCase().trim(), r]));
  log(`  ${bMap.size} rows.`);

  // 2. Load all HRMS snapshot rows (id + employee_code)
  log('Loading legacy_salary_snapshot...');
  const [hRows] = await hrms.query('SELECT id, employee_code FROM legacy_salary_snapshot');
  log(`  ${hRows.length} rows.`);

  // 3. Build update list
  const toUpdate = [];
  let notFound = 0;
  for (const h of hRows) {
    const b = bMap.get(h.employee_code.toUpperCase().trim());
    if (!b) { notFound++; continue; }
    toUpdate.push({ id: h.id, b });
  }
  log(`  Will update: ${toUpdate.length}  not in db_bill: ${notFound}`);

  // 4. Bulk INSERT ... ON DUPLICATE KEY UPDATE in batches
  // The PK is `id` (UUID) — ON DUPLICATE KEY will update all other columns
  const UPDATE_COLS = [
    'employee_name','branch_name','process','designation','doj','dol',
    'basic','hra','conveyance','da','medical','special_allowance','other_allowance',
    'pf_employee','pf_employer','esic_employee','esic_employer','pt',
    'gross','net_salary','ctc_monthly','ctc_annual',
    'pf_eligible','esic_eligible','db_bill_id','db_bill_last_updated',
  ];

  // vals per row = 27: id + employee_code + 25 data cols. db_bill_last_updated = NOW(). Total = 28 cols.
  const NCOLS  = 27;
  const ROW_PH = '(' + Array(NCOLS).fill('?').join(',') + ',NOW())';
  const SET_CLAUSE = UPDATE_COLS.map(c=>
    c === 'db_bill_last_updated' ? `db_bill_last_updated=NOW()` : `${c}=VALUES(${c})`
  ).join(', ');

  let processed = 0;

  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const batch = toUpdate.slice(i, i+BATCH);
    const vals  = [];

    for (const { id, b } of batch) {
      vals.push(
        id,                                          // id (PK)
        b.EmpCode.toUpperCase().trim(),              // employee_code
        str(b.EmpName),                              // employee_name
        str(b.BranchName),               // branch_name
        str(b.Process),                  // process
        str(b.Desgination),              // designation
        dt(b.DOJ),                       // doj
        dt(b.DOL),                       // dol
        n(b.bs),                         // basic
        n(b.hra),                        // hra
        n(b.conv),                       // conveyance
        n(b.da),                         // da
        n(b.ma),                         // medical  ← ma (actual medical allow)
        n(b.sa),                         // special_allowance
        n(b.oa),                         // other_allowance
        n(b.EPF),                        // pf_employee
        n(b.EPFCO),                      // pf_employer
        n(b.ESIC),                       // esic_employee
        n(b.ESICCO),                     // esic_employer
        n(b.ProfessionalTax),            // pt
        n(b.Gross),                      // gross
        n(b.NetInhand),                  // net_salary
        n(b.CTC),                        // ctc_monthly
        n(b.CTC) * 12,                   // ctc_annual
        bool(b.pfelig),                  // pf_eligible
        bool(b.esielig),                 // esic_eligible
        n(b.Id),                         // db_bill_id
      );
    }

    await hrms.query(`
      INSERT INTO legacy_salary_snapshot
        (id, employee_code, employee_name, branch_name, process, designation, doj, dol,
         basic, hra, conveyance, da, medical, special_allowance, other_allowance,
         pf_employee, pf_employer, esic_employee, esic_employer, pt,
         gross, net_salary, ctc_monthly, ctc_annual,
         pf_eligible, esic_eligible, db_bill_id, db_bill_last_updated)
      VALUES ${batch.map(()=>ROW_PH).join(',')}
      ON DUPLICATE KEY UPDATE ${SET_CLAUSE}
    `, vals);

    processed += batch.length;
    process.stdout.write(`\r  ${processed}/${toUpdate.length} updated...   `);
  }

  process.stdout.write('\n');
  log(`DONE. Updated=${processed}  NotFound=${notFound}`);

  // 5. Quick verification
  const [[res]] = await hrms.query(`
    SELECT SUM(basic) basic, SUM(hra) hra, SUM(special_allowance) sa,
           SUM(pf_employer) pf_co, SUM(gross) gross, SUM(net_salary) net
    FROM legacy_salary_snapshot WHERE employee_code NOT LIKE 'IDC%'
  `);
  log(`Snapshot totals: basic=${Math.round(res.basic)}  hra=${Math.round(res.hra)}  sa=${Math.round(res.sa)}  pf_co=${Math.round(res.pf_co)}  gross=${Math.round(res.gross)}  net=${Math.round(res.net)}`);

  await bill.end(); await hrms.end();
}

main().catch(e=>{ console.error('FATAL:', e.message); process.exit(1); });
