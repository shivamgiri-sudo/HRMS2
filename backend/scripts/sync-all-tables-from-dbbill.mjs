/**
 * sync-all-tables-from-dbbill.mjs
 *
 * INSERT IGNORE / NOT EXISTS only — never deletes any data.
 *
 * Covers every remaining db_bill gap EXCEPT attendance (see sync-attendance-legacy.mjs):
 *   1.  dashboard_target_revenue  → bill_revenue_target_snapshot   (410K rows, 0 migrated)
 *   2.  dashboard_data_revenue    → bill_revenue_actual_snapshot    (339K rows, 0 migrated)
 *   3.  his_masjsclrentry         → employee_salary_history         (13K rows, 0 migrated)
 *   4.  leave_management          → leave_request (legacy_leave_id) (2,412 gap)
 *   5.  od_apply_master           → od_register_snapshot             (322 gap)
 *   6.  LoanMaster                → employee_loans                   (39 gap)
 *   7.  masjclrentry              → legacy_salary_snapshot           (46 gap)
 *   8.  mas_docoments             → doc_legacy_snapshot (NEW)        (65K gap)
 *   9.  IncomtaxMaster            → incometax_legacy_snapshot (NEW)  (1,492)
 *  10.  ChangeDojMaster           → change_doj_snapshot (NEW)        (1,541)
 *  11.  employee_move             → employee_move_snapshot (NEW)     (1,086)
 *  12.  FieldAttandence           → field_attendance_snapshot (NEW)  (106K)
 *  13.  qual_leave                → qual_leave_snapshot (NEW)        (18K)
 *  14.  qual_attendance           → qual_attendance_snapshot (NEW)   (11K)
 *  15.  qual_salary               → qual_salary_snapshot (NEW)       (9K)
 *  16.  salary_master_upload      → salary_upload_snapshot (NEW)     (39K)
 *
 * Usage:
 *   node backend/scripts/sync-all-tables-from-dbbill.mjs --hrms-host=122.184.128.90
 *   node backend/scripts/sync-all-tables-from-dbbill.mjs --dry-run
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

const HRMS_HOST = arg('hrms-host', process.env.DB_HOST ?? fromEnvFile('DB_HOST') ?? '122.184.128.90');
const BILL_HOST = arg('bill-host', '14.97.30.236');
const DB_USER   = process.env.DB_USER     ?? fromEnvFile('DB_USER');
const DB_PASS   = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD');
const DRY_RUN   = process.argv.includes('--dry-run');
const PAGE      = 2000;
const BATCH     = 500;

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }
function h(n)   { return String(n).padStart(2,'0'); }

function monthStrToDate(fy, fm) {
  // fy = '2018-19', fm = 'Apr' → '2018-04-01'
  const monthMap = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                     Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const mo = monthMap[fm] || '01';
  const yr = fy ? fy.split('-')[0] : '2000';
  // Financial year Apr–Mar: Apr–Dec use first year, Jan–Mar use second year
  const fyYear1 = parseInt(yr);
  const fyYear2 = fyYear1 + 1;
  const useYear = (parseInt(mo) >= 4) ? fyYear1 : fyYear2;
  return `${useYear}-${mo}-01`;
}

async function batchInsert(hrms, table, rows) {
  if (!rows.length || DRY_RUN) return 0;
  let ins = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const b = rows.slice(i, i + BATCH);
    const keys = Object.keys(b[0]);
    const ph = b.map(() => `(${keys.map(() => '?').join(',')})`).join(',');
    const vals = b.flatMap(r => keys.map(k => r[k]));
    const [res] = await hrms.execute(
      `INSERT IGNORE INTO ${table} (${keys.join(',')}) VALUES ${ph}`, vals);
    ins += res.affectedRows;
  }
  return ins;
}

// ─── Helper: load employee_code → employee_id map ────────────────────────────
async function loadEmpMap(hrms) {
  const [rows] = await hrms.execute('SELECT employee_code, id FROM employees');
  return new Map(rows.map(r => [r.employee_code, r.id]));
}

// ─── helper: add a column only if it doesn't exist yet ───────────────────────
async function addColIfMissing(hrms, table, col, definition) {
  const [[{cnt}]] = await hrms.execute(
    `SELECT COUNT(*) cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME=? AND COLUMN_NAME=?`, [table, col]);
  if (cnt === 0 && !DRY_RUN) {
    await hrms.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
  }
}

// ─── 1. Revenue target + actual ──────────────────────────────────────────────
async function syncRevenue(bill, hrms) {
  log('=== 1. Revenue tables ===');

  // Add missing columns to existing (empty) snapshot tables one by one
  const extraCols = [
    ['branch',                    'VARCHAR(200)  DEFAULT NULL'],
    ['finance_year',              'VARCHAR(10)   DEFAULT NULL'],
    ['finance_month',             'VARCHAR(10)   DEFAULT NULL'],
    ['finance_month1',            'VARCHAR(10)   DEFAULT NULL'],
    ['insert_date',               'DATETIME      DEFAULT NULL'],
    ['cost_center_id',            'INT           DEFAULT NULL'],
    ['header_id',                 'INT           DEFAULT NULL'],
    ['cost_center_month_det',     'VARCHAR(200)  DEFAULT NULL'],
    ['cost_center_month_det_rate','VARCHAR(50)   DEFAULT NULL'],
    ['forecast',                  'DECIMAL(15,2) DEFAULT 0'],
    ['mtd',                       'DECIMAL(15,2) DEFAULT 0'],
    ['db_bill_created_at',        'DATETIME      DEFAULT NULL'],
    ['db_bill_created_by',        'INT           DEFAULT NULL'],
  ];
  for (const [col, def] of extraCols) {
    await addColIfMissing(hrms, 'bill_revenue_target_snapshot', col, def);
    await addColIfMissing(hrms, 'bill_revenue_actual_snapshot', col, def);
  }
  log('  Revenue snapshot schemas ready.');

  // Sync target
  const [[{bt}]] = await bill.execute('SELECT COUNT(*) bt FROM dashboard_target_revenue');
  const [[{ht}]] = await hrms.execute('SELECT COUNT(*) ht FROM bill_revenue_target_snapshot');
  log(`  dashboard_target_revenue: bill=${bt}  hrms=${ht}  gap=${bt-ht}`);

  let offset = 0, inserted = 0;
  while (true) {
    const [rows] = await bill.execute(`
      SELECT DashId AS source_id, branch, FinanceYear AS finance_year,
             FinanceMonth AS finance_month, FinanceMonth1 AS finance_month1,
             insertDate AS insert_date, CostCenterId AS cost_center_id,
             HeaderId AS header_id, CostCenterMonthDet AS cost_center_month_det,
             CostCenterMonthDetRate AS cost_center_month_det_rate,
             Forecast AS forecast, Mtd AS mtd,
             created_at AS db_bill_created_at, created_by AS db_bill_created_by,
             branch AS process_name,
             NULL AS target_month, NULL AS target_revenue
      FROM dashboard_target_revenue ORDER BY DashId LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    // Compute target_month and target_revenue
    const mapped = rows.map(r => ({
      ...r,
      target_month: (r.finance_year && r.finance_month) ? monthStrToDate(r.finance_year, r.finance_month) : null,
      target_revenue: r.forecast,
    }));
    inserted += await batchInsert(hrms, 'bill_revenue_target_snapshot', mapped);
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  log(`  Inserted ${inserted} target rows.`);

  // Sync actual
  const [[{ba}]] = await bill.execute('SELECT COUNT(*) ba FROM dashboard_data_revenue');
  const [[{ha}]] = await hrms.execute('SELECT COUNT(*) ha FROM bill_revenue_actual_snapshot');
  log(`  dashboard_data_revenue: bill=${ba}  hrms=${ha}  gap=${ba-ha}`);

  offset = 0; let inserted2 = 0;
  while (true) {
    const [rows] = await bill.execute(`
      SELECT DashId AS source_id, branch, FinanceYear AS finance_year,
             FinanceMonth AS finance_month, FinanceMonth1 AS finance_month1,
             insertDate AS insert_date, CostCenterId AS cost_center_id,
             HeaderId AS header_id, CostCenterMonthDet AS cost_center_month_det,
             CostCenterMonthDetRate AS cost_center_month_det_rate,
             Forecast AS forecast, Mtd AS mtd,
             created_at AS db_bill_created_at, created_by AS db_bill_created_by,
             branch AS process_name,
             NULL AS revenue_date, NULL AS actual_revenue
      FROM dashboard_data_revenue ORDER BY DashId LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    const mapped = rows.map(r => ({
      ...r,
      revenue_date: (r.finance_year && r.finance_month) ? monthStrToDate(r.finance_year, r.finance_month) : null,
      actual_revenue: r.forecast,
    }));
    inserted2 += await batchInsert(hrms, 'bill_revenue_actual_snapshot', mapped);
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  log(`  Inserted ${inserted2} actual rows.`);
}

// ─── 2. Salary revision history ──────────────────────────────────────────────
async function syncSalaryHistory(bill, hrms, empMap) {
  log('=== 2. Salary revision history: his_masjsclrentry → employee_salary_history ===');

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM his_masjsclrentry');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM employee_salary_history');
  log(`  his_masjsclrentry: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset = 0, inserted = 0, skipped = 0;
  while (true) {
    const [rows] = await bill.execute(`
      SELECT id, EmpCode, BranchName, Desgination, DOJ, DOL, lastUpdated, CreateDate,
             bs, hra, conv, da, portf, ma, lta, sa, oa, Bonus, PLI,
             Gross, NetInhand, CTC, EPF, EPFCO, ESIC, ESICCO, ProfessionalTax, AdminCharges,
             pfelig, esielig
      FROM his_masjsclrentry
      ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;

    const toInsert = [];
    for (const r of rows) {
      const empId = empMap.get(r.EmpCode);
      if (!empId) { skipped++; continue; }

      toInsert.push({
        employee_id:          empId,
        effective_from:       r.DOJ || r.CreateDate || '2018-01-01',
        effective_to:         r.DOL || null,
        source:               'data_migration',
        legacy_row_id:        r.id,
        basic:                Number(r.bs)   || 0,
        hra:                  Number(r.hra)  || 0,
        conveyance:           Number(r.conv) || 0,
        portfolio_allowance:  Number(r.portf)|| 0,
        medical_allowance:    Number(r.ma)   || 0,
        special_allowance:    Number(r.sa)   || 0,
        other_allowance:      Number(r.oa)   || 0,
        bonus:                Number(r.Bonus)|| 0,
        pli:                  Number(r.PLI)  || 0,
        lta:                  Number(r.lta)  || 0,
        gross:                Number(r.Gross)|| 0,
        net_in_hand:          Number(r.NetInhand)||0,
        ctc:                  Number(r.CTC)  || 0,
        epf_employee:         Number(r.EPF)  || 0,
        esic_employee:        Number(r.ESIC) || 0,
        professional_tax:     Number(r.ProfessionalTax)||0,
        epf_employer:         Number(r.EPFCO)||0,
        esic_employer:        Number(r.ESICCO)||0,
        admin_charges:        Number(r.AdminCharges)||0,
        branch_name:          r.BranchName   || null,
        designation_name:     r.Desgination  || null,
        is_current:           0,
        legacy_updated_at:    r.lastUpdated  || null,
      });
    }

    // Use INSERT IGNORE — legacy_row_id uniqueness not enforced by DB, so check manually
    // We only insert if this legacy_row_id doesn't already exist
    if (toInsert.length && !DRY_RUN) {
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const b = toInsert.slice(i, i + BATCH);
        const ids = b.map(r => r.legacy_row_id);
        const [existing] = await hrms.execute(
          `SELECT legacy_row_id FROM employee_salary_history WHERE legacy_row_id IN (${ids.map(()=>'?').join(',')}) AND source='his_masjsclrentry'`,
          ids);
        const existSet = new Set(existing.map(r => r.legacy_row_id));
        const fresh = b.filter(r => !existSet.has(r.legacy_row_id));
        if (fresh.length) {
          const keys = Object.keys(fresh[0]);
          const ph = fresh.map(()=>`(${keys.map(()=>'?').join(',')})`).join(',');
          const vals = fresh.flatMap(r => keys.map(k => r[k]));
          const [res] = await hrms.execute(`INSERT INTO employee_salary_history (${keys.join(',')}) VALUES ${ph}`, vals);
          inserted += res.affectedRows;
        }
      }
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  log(`  Done. Inserted ${inserted}, skipped (emp not found) ${skipped}.`);
}

// ─── 3. Leave gap ─────────────────────────────────────────────────────────────
async function syncLeaveGap(bill, hrms, empMap) {
  log('=== 3. Leave gap: leave_management → leave_request ===');

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM leave_management');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM leave_request WHERE legacy_leave_id IS NOT NULL');
  log(`  leave_management: bill=${bc}  hrms(with legacy_id)=${hc}`);

  // Load leave_type_master — columns: id (UUID), leave_code, leave_name
  const [ltRows] = await hrms.execute('SELECT id, leave_code, leave_name FROM leave_type_master');
  const ltByCode = new Map(ltRows.map(r => [(r.leave_code||'').toUpperCase().trim(), r.id]));
  const ltByName = new Map(ltRows.map(r => [(r.leave_name||'').toUpperCase().trim(), r.id]));
  const defaultLtId = ltByCode.get('LWP') || ltByCode.get('CL') || ltRows[0]?.id;

  log(`  Leave types: ${ltRows.map(r=>r.leave_code+':'+r.leave_name).join(', ')}`);

  function mapLeaveType(lt) {
    if (!lt) return defaultLtId;
    const u = (lt||'').toUpperCase().trim();
    if (ltByCode.has(u)) return ltByCode.get(u);
    if (ltByName.has(u)) return ltByName.get(u);
    for (const [k,v] of ltByCode) { if (k.includes(u) || u.includes(k)) return v; }
    return defaultLtId;
  }
  function mapStatus(s, cs) {
    const v = (cs || s || '').toLowerCase();
    if (v.includes('appro')) return 'approved';
    if (v.includes('reject') || v.includes('disap')) return 'rejected';
    if (v.includes('cancel')) return 'cancelled';
    return 'approved';
  }

  let offset = 0, inserted = 0, skipped = 0;
  while (true) {
    const [rows] = await bill.execute(`
      SELECT Id, EmpCode, LeaveFrom, LeaveTo, LeaveType, TotalLeave,
             Purpose, Status, CurrentStatus, CreateDate
      FROM leave_management
      ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;

    const ids = rows.map(r => r.Id);
    const [existing] = await hrms.execute(
      `SELECT legacy_leave_id FROM leave_request WHERE legacy_leave_id IN (${ids.map(()=>'?').join(',')})`, ids);
    const existSet = new Set(existing.map(r => r.legacy_leave_id));

    const toInsert = [];
    for (const r of rows) {
      if (existSet.has(r.Id)) continue;
      const empId = empMap.get(r.EmpCode);
      if (!empId) { skipped++; continue; }
      if (!r.LeaveFrom || !r.LeaveTo) { skipped++; continue; }

      toInsert.push({
        employee_id:    empId,
        leave_type_id:  mapLeaveType(r.LeaveType),
        from_date:      r.LeaveFrom,
        to_date:        r.LeaveTo,
        start_date:     r.LeaveFrom,
        end_date:       r.LeaveTo,
        total_days:     Number(r.TotalLeave) || 1,
        reason:         r.Purpose || null,
        status:         mapStatus(r.Status, r.CurrentStatus),
        approval_level: 0,
        leave_type_code: r.LeaveType || null,
        payroll_closed_flag: 0,
        backdated_applied: 1,
        requires_branch_head_approval: 0,
        applied_at:     r.CreateDate || new Date(),
        requested_at:   r.CreateDate || new Date(),
        created_at:     r.CreateDate || new Date(),
        legacy_leave_id: r.Id,
        legacy_created_at: r.CreateDate || null,
      });
    }

    if (toInsert.length && !DRY_RUN) {
      const keys = Object.keys(toInsert[0]);
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const b = toInsert.slice(i, i + BATCH);
        const ph = b.map(()=>`(${keys.map(()=>'?').join(',')})`).join(',');
        const vals = b.flatMap(r => keys.map(k => r[k]));
        try {
          const [res] = await hrms.execute(`INSERT IGNORE INTO leave_request (${keys.join(',')}) VALUES ${ph}`, vals);
          inserted += res.affectedRows;
        } catch(e) {
          // If FK error on leave_type_id, skip and log
          log(`  WARN leave_type FK: ${e.message.slice(0,80)}`);
        }
      }
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  log(`  Done. Inserted ${inserted}, skipped (no emp/date) ${skipped}.`);
}

// ─── 4. OD gap ────────────────────────────────────────────────────────────────
async function syncOdGap(bill, hrms) {
  log('=== 4. OD gap: od_apply_master → od_register_snapshot ===');
  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM od_apply_master');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM od_register_snapshot');
  log(`  od_apply_master: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, BranchName AS branch_name, EmpCode AS employee_code,
             EmpName AS employee_name, Designation AS designation,
             CurrentStatus AS current_status, StartDate AS start_date, EndDate AS end_date,
             Reason AS reason, ApproveFirst AS approve_first, ApproveFirstDate AS approve_first_at,
             ApproveSecond AS approve_second, ApproveSecondDate AS approve_second_at,
             DiscardStatus AS discard_status, DiscardReason AS discard_reason,
             DiscardDate AS discard_date, CreateDate AS created_at
      FROM od_apply_master ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'od_register_snapshot', rows);
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 5. Loan gap ──────────────────────────────────────────────────────────────
async function syncLoanGap(bill, hrms, empMap) {
  log('=== 5. Loan gap: LoanMaster → employee_loans ===');
  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM LoanMaster');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM employee_loans');
  log(`  LoanMaster: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0, skipped=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id, Type, BranchName, CostCenter, EmpCode, EmpName, Amount, StartDate, EndDate,
             Installments, DeductionPerMonth, DeductedAmount, PendingAmount, GuarantorName,
             GuarantorEmpCode, Reason, ChequeNumber, ChequeBankName, ChequeDate,
             RTGSNumber, RTGSDate, TransationStatus, CreateDate, LastUpdateDate
      FROM LoanMaster ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;

    const ids = rows.map(r=>r.Id);
    const [existing] = await hrms.execute(
      `SELECT legacy_loan_id FROM employee_loans WHERE legacy_loan_id IN (${ids.map(()=>'?').join(',')})`, ids);
    const existSet = new Set(existing.map(r=>r.legacy_loan_id));

    const toInsert = [];
    for (const r of rows) {
      if (existSet.has(r.Id)) continue;
      const empId = empMap.get(r.EmpCode);
      if (!empId) { skipped++; continue; }
      toInsert.push({
        employee_id:       empId,
        employee_code:     r.EmpCode,
        loan_type:         r.Type || 'general',
        amount:            Number(r.Amount)||0,
        start_date:        r.StartDate || null,
        end_date:          r.EndDate   || null,
        installments:      Number(r.Installments)||0,
        deduction_per_month: Number(r.DeductionPerMonth)||0,
        deducted_amount:   Number(r.DeductedAmount)||0,
        pending_amount:    Number(r.PendingAmount)||0,
        status:            (r.TransationStatus||'active').toLowerCase(),
        guarantor_name:    r.GuarantorName||null,
        guarantor_emp_code: r.GuarantorEmpCode||null,
        reason:            r.Reason||null,
        cheque_number:     r.ChequeNumber||null,
        cheque_bank:       r.ChequeBankName||null,
        cheque_date:       r.ChequeDate||null,
        rtgs_number:       r.RTGSNumber||null,
        rtgs_date:         r.RTGSDate||null,
        branch_name:       r.BranchName||null,
        cost_center:       r.CostCenter||null,
        legacy_loan_id:    r.Id,
        legacy_created_at: r.CreateDate||null,
        legacy_updated_at: r.LastUpdateDate||null,
        created_at:        r.CreateDate||new Date(),
        updated_at:        r.LastUpdateDate||new Date(),
      });
    }
    if (toInsert.length && !DRY_RUN) {
      const keys = Object.keys(toInsert[0]);
      for (let i=0; i<toInsert.length; i+=BATCH) {
        const b=toInsert.slice(i,i+BATCH);
        const ph=b.map(()=>`(${keys.map(()=>'?').join(',')})`).join(',');
        const vals=b.flatMap(r=>keys.map(k=>r[k]));
        const [res]=await hrms.execute(`INSERT IGNORE INTO employee_loans (${keys.join(',')}) VALUES ${ph}`,vals);
        inserted+=res.affectedRows;
      }
    }
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}, skipped ${skipped}.`);
}

// ─── 6. masjclrentry gap ─────────────────────────────────────────────────────
async function syncMasjclrGap(bill, hrms) {
  log('=== 6. masjclrentry gap → legacy_salary_snapshot ===');
  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM masjclrentry');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM legacy_salary_snapshot');
  log(`  masjclrentry: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT id AS db_bill_id, EmpCode AS employee_code, EmpName AS employee_name,
             BranchName AS branch_name, Process AS process, Desgination AS designation,
             DOJ AS doj, DOL AS dol, lastUpdated AS db_bill_last_updated,
             bs AS basic, hra, conv AS conveyance, da, portf AS medical,
             sa AS special_allowance, oa AS other_allowance,
             EPF AS pf_employee, EPFCO AS pf_employer,
             ESIC AS esic_employee, ESICCO AS esic_employer,
             ProfessionalTax AS pt, Gross AS gross, NetInhand AS net_salary,
             CTC AS ctc_monthly, pfelig AS pf_eligible, esielig AS esic_eligible
      FROM masjclrentry ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;

    const ids = rows.map(r=>r.db_bill_id);
    const [existing] = await hrms.execute(
      `SELECT db_bill_id FROM legacy_salary_snapshot WHERE db_bill_id IN (${ids.map(()=>'?').join(',')})`, ids);
    const existSet = new Set(existing.map(r=>r.db_bill_id));
    const fresh = rows.filter(r=>!existSet.has(r.db_bill_id)).map(r=>({...r, effective_date: r.doj||null}));
    inserted += await batchInsert(hrms, 'legacy_salary_snapshot', fresh);

    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 7. mas_docoments gap ────────────────────────────────────────────────────
async function syncDocsGap(bill, hrms) {
  log('=== 7. mas_docoments → doc_legacy_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS doc_legacy_snapshot (
      id          INT UNSIGNED NOT NULL,
      offer_no    VARCHAR(100) DEFAULT NULL,
      interview_id INT          DEFAULT NULL,
      doc_type    VARCHAR(100) DEFAULT NULL,
      doc_name    VARCHAR(500) DEFAULT NULL,
      filename    VARCHAR(500) DEFAULT NULL,
      file_no     VARCHAR(100) DEFAULT NULL,
      page_no     VARCHAR(50)  DEFAULT NULL,
      box_no      VARCHAR(50)  DEFAULT NULL,
      doc_status  VARCHAR(50)  DEFAULT NULL,
      doc_status_date DATETIME DEFAULT NULL,
      doc_status_remark VARCHAR(500) DEFAULT NULL,
      save_date   DATETIME     DEFAULT NULL,
      synced_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_emp(offer_no), KEY idx_interview(interview_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM mas_docoments');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM doc_legacy_snapshot');
  log(`  mas_docoments: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, OfferNo AS offer_no, Interview_Id AS interview_id,
             DocType AS doc_type, DocName AS doc_name, filename, fileno AS file_no,
             PageNo AS page_no, BoxNo AS box_no, DocStatus AS doc_status,
             DocStatusDate AS doc_status_date, DocStatusRemark AS doc_status_remark,
             saveDate AS save_date
      FROM mas_docoments ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'doc_legacy_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 8. IncomtaxMaster ───────────────────────────────────────────────────────
async function syncIncomeTax(bill, hrms) {
  log('=== 8. IncomtaxMaster → incometax_legacy_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS incometax_legacy_snapshot (
      id             INT UNSIGNED NOT NULL,
      employee_code  VARCHAR(50)  DEFAULT NULL,
      employee_name  VARCHAR(255) DEFAULT NULL,
      branch_name    VARCHAR(255) DEFAULT NULL,
      tax_month      VARCHAR(20)  DEFAULT NULL,
      income_tax     DECIMAL(12,2) DEFAULT 0,
      import_date    DATETIME     DEFAULT NULL,
      synced_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_emp(employee_code), KEY idx_month(tax_month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM IncomtaxMaster');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM incometax_legacy_snapshot');
  log(`  IncomtaxMaster: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, EmpCode AS employee_code, EmpName AS employee_name,
             BranchName AS branch_name, TaxMonth AS tax_month,
             IncomTax AS income_tax, ImportDate AS import_date
      FROM IncomtaxMaster ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'incometax_legacy_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 9. ChangeDojMaster ──────────────────────────────────────────────────────
async function syncChangeDoj(bill, hrms) {
  log('=== 9. ChangeDojMaster → change_doj_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS change_doj_snapshot (
      id            INT UNSIGNED NOT NULL,
      branch_name   VARCHAR(255) DEFAULT NULL,
      employee_code VARCHAR(50)  DEFAULT NULL,
      employee_name VARCHAR(255) DEFAULT NULL,
      old_doj       DATE         DEFAULT NULL,
      new_doj       DATE         DEFAULT NULL,
      remarks       VARCHAR(500) DEFAULT NULL,
      approve_status VARCHAR(50) DEFAULT NULL,
      approve_date  DATETIME     DEFAULT NULL,
      created_at    DATETIME     DEFAULT NULL,
      synced_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_emp(employee_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM ChangeDojMaster');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM change_doj_snapshot');
  log(`  ChangeDojMaster: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, BranchName AS branch_name, EmpCode AS employee_code,
             EmpName AS employee_name, OldDOJ AS old_doj, NewDOJ AS new_doj,
             Remarks AS remarks, ApproveStatus AS approve_status,
             ApproveDate AS approve_date, CreateDate AS created_at
      FROM ChangeDojMaster ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'change_doj_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 10. employee_move ───────────────────────────────────────────────────────
async function syncEmpMove(bill, hrms) {
  log('=== 10. employee_move → employee_move_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS employee_move_snapshot (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      employee_code VARCHAR(50)  DEFAULT NULL,
      from_branch   VARCHAR(255) DEFAULT NULL,
      to_branch     VARCHAR(255) DEFAULT NULL,
      from_cost_center VARCHAR(255) DEFAULT NULL,
      to_cost_center   VARCHAR(255) DEFAULT NULL,
      move_month    VARCHAR(20)  DEFAULT NULL,
      reason        VARCHAR(500) DEFAULT NULL,
      move_by       VARCHAR(100) DEFAULT NULL,
      move_date     DATETIME     DEFAULT NULL,
      synced_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_emp(employee_code),
      UNIQUE KEY uq_move(employee_code, move_month, from_branch(100), to_branch(100))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM employee_move');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM employee_move_snapshot');
  log(`  employee_move: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT EmpCode AS employee_code, FromBranch AS from_branch, ToBranch AS to_branch,
             FromCostCenter AS from_cost_center, ToCostCenter AS to_cost_center,
             MoveMonth AS move_month, Reason AS reason, MoveBy AS move_by,
             MoveDate AS move_date
      FROM employee_move ORDER BY EmpMoveId LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'employee_move_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 11. FieldAttandence ─────────────────────────────────────────────────────
async function syncFieldAtt(bill, hrms) {
  log('=== 11. FieldAttandence → field_attendance_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS field_attendance_snapshot (
      id            INT UNSIGNED NOT NULL,
      employee_code VARCHAR(50)  DEFAULT NULL,
      employee_name VARCHAR(255) DEFAULT NULL,
      branch_name   VARCHAR(255) DEFAULT NULL,
      cost_center   VARCHAR(255) DEFAULT NULL,
      attend_date   DATE         DEFAULT NULL,
      status        VARCHAR(20)  DEFAULT NULL,
      old_status    VARCHAR(20)  DEFAULT NULL,
      created_at    DATETIME     DEFAULT NULL,
      synced_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_emp(employee_code), KEY idx_date(attend_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM FieldAttandence');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM field_attendance_snapshot');
  log(`  FieldAttandence: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, EmpCode AS employee_code, EmpName AS employee_name,
             BranchName AS branch_name, CostCenter AS cost_center,
             Status AS status, OldStatus AS old_status, AttandDate AS attend_date,
             CreateDate AS created_at
      FROM FieldAttandence ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'field_attendance_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 12. qual_leave ──────────────────────────────────────────────────────────
async function syncQualLeave(bill, hrms) {
  log('=== 12. qual_leave → qual_leave_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS qual_leave_snapshot (
      id            INT UNSIGNED NOT NULL,
      employee_code VARCHAR(50)  DEFAULT NULL,
      pl            DECIMAL(6,2) DEFAULT 0,
      cl            DECIMAL(6,2) DEFAULT 0,
      sl            DECIMAL(6,2) DEFAULT 0,
      leave_status  VARCHAR(50)  DEFAULT NULL,
      leave_month   VARCHAR(20)  DEFAULT NULL,
      leave_year    VARCHAR(10)  DEFAULT NULL,
      synced_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_emp(employee_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM qual_leave');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM qual_leave_snapshot');
  log(`  qual_leave: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, EmpCode AS employee_code, PL AS pl, CL AS cl, SL AS sl,
             LeaveStatus AS leave_status, LeaveMonth AS leave_month, LeaveYear AS leave_year
      FROM qual_leave ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'qual_leave_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 13. qual_attendance ─────────────────────────────────────────────────────
async function syncQualAtt(bill, hrms) {
  log('=== 13. qual_attendance → qual_attendance_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS qual_attendance_snapshot (
      id            INT UNSIGNED NOT NULL,
      employee_code VARCHAR(50)  DEFAULT NULL,
      present       DECIMAL(6,2) DEFAULT 0,
      wo            DECIMAL(6,2) DEFAULT 0,
      holiday       DECIMAL(6,2) DEFAULT 0,
      half_day      DECIMAL(6,2) DEFAULT 0,
      compoff       DECIMAL(6,2) DEFAULT 0,
      el            DECIMAL(6,2) DEFAULT 0,
      cl            DECIMAL(6,2) DEFAULT 0,
      sl            DECIMAL(6,2) DEFAULT 0,
      arrer_days    DECIMAL(6,2) DEFAULT 0,
      ot            DECIMAL(6,2) DEFAULT 0,
      sal_month     VARCHAR(20)  DEFAULT NULL,
      sal_year      VARCHAR(10)  DEFAULT NULL,
      created_at    DATETIME     DEFAULT NULL,
      synced_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_emp(employee_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM qual_attendance');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM qual_attendance_snapshot');
  log(`  qual_attendance: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, EmpCode AS employee_code, Present AS present, WO AS wo,
             Holiday AS holiday, HalfDay AS half_day, Compoff AS compoff,
             EL AS el, CL AS cl, SL AS sl, ArrerDays AS arrer_days, OT AS ot,
             SalMonth AS sal_month, SalYear AS sal_year, CreateDate AS created_at
      FROM qual_attendance ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'qual_attendance_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 14. qual_salary ─────────────────────────────────────────────────────────
async function syncQualSalary(bill, hrms) {
  log('=== 14. qual_salary → qual_salary_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS qual_salary_snapshot (
      id              INT UNSIGNED NOT NULL,
      qual_emp_code   VARCHAR(50)  DEFAULT NULL,
      employee_code   VARCHAR(50)  DEFAULT NULL,
      employee_name   VARCHAR(255) DEFAULT NULL,
      designation     VARCHAR(200) DEFAULT NULL,
      doj             DATE         DEFAULT NULL,
      basic           DECIMAL(12,2) DEFAULT 0,
      hra             DECIMAL(12,2) DEFAULT 0,
      conv            DECIMAL(12,2) DEFAULT 0,
      other_allowance DECIMAL(12,2) DEFAULT 0,
      gross           DECIMAL(12,2) DEFAULT 0,
      paid_days       DECIMAL(6,2)  DEFAULT 0,
      total_gross     DECIMAL(12,2) DEFAULT 0,
      pf              DECIMAL(12,2) DEFAULT 0,
      tds             DECIMAL(12,2) DEFAULT 0,
      esi             DECIMAL(12,2) DEFAULT 0,
      net_pay         DECIMAL(12,2) DEFAULT 0,
      sal_month       VARCHAR(20)   DEFAULT NULL,
      sal_year        VARCHAR(10)   DEFAULT NULL,
      save_date       DATETIME      DEFAULT NULL,
      synced_at       DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_emp(employee_code), KEY idx_month(sal_month, sal_year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM qual_salary');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM qual_salary_snapshot');
  log(`  qual_salary: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, QualEmpCode AS qual_emp_code, EmpCode AS employee_code,
             EmapName AS employee_name, Desg AS designation, DOJ AS doj,
             Basic AS basic, HRA AS hra, Conv AS conv, OthAllw AS other_allowance,
             Gross AS gross, Paiddays AS paid_days, TotalGross AS total_gross,
             PF AS pf, TDS AS tds, ESI AS esi, Netpay AS net_pay,
             SalMonth AS sal_month, SalYear AS sal_year, SaveDate AS save_date
      FROM qual_salary ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'qual_salary_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── 15. salary_master_upload ────────────────────────────────────────────────
async function syncSalaryUpload(bill, hrms) {
  log('=== 15. salary_master_upload → salary_upload_snapshot ===');
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS salary_upload_snapshot (
      data_id         INT UNSIGNED NOT NULL,
      employee_code   VARCHAR(50)  DEFAULT NULL,
      employee_name   VARCHAR(255) DEFAULT NULL,
      cost_center     VARCHAR(255) DEFAULT NULL,
      designation     VARCHAR(200) DEFAULT NULL,
      branch          VARCHAR(255) DEFAULT NULL,
      basic           DECIMAL(12,2) DEFAULT 0,
      hra             DECIMAL(12,2) DEFAULT 0,
      gross           DECIMAL(12,2) DEFAULT 0,
      net_salary      DECIMAL(12,2) DEFAULT 0,
      ctc             DECIMAL(12,2) DEFAULT 0,
      pf_employee     DECIMAL(12,2) DEFAULT 0,
      pf_employer     DECIMAL(12,2) DEFAULT 0,
      esic_employee   DECIMAL(12,2) DEFAULT 0,
      esic_employer   DECIMAL(12,2) DEFAULT 0,
      income_tax      DECIMAL(12,2) DEFAULT 0,
      professional_tax DECIMAL(12,2) DEFAULT 0,
      working_days    DECIMAL(6,2)  DEFAULT 0,
      earned_days     DECIMAL(6,2)  DEFAULT 0,
      sal_date        DATETIME      DEFAULT NULL,
      finance_year    VARCHAR(10)   DEFAULT NULL,
      finance_month   VARCHAR(10)   DEFAULT NULL,
      salary_payment_mode VARCHAR(50) DEFAULT NULL,
      synced_at       DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (data_id),
      KEY idx_emp(employee_code), KEY idx_fy(finance_year, finance_month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [[{bc}]] = await bill.execute('SELECT COUNT(*) bc FROM salary_master_upload');
  const [[{hc}]] = await hrms.execute('SELECT COUNT(*) hc FROM salary_upload_snapshot');
  log(`  salary_master_upload: bill=${bc}  hrms=${hc}  gap=${bc-hc}`);

  let offset=0, inserted=0;
  while(true) {
    const [rows] = await bill.execute(`
      SELECT DataId AS data_id, EmpCode AS employee_code, EmpName AS employee_name,
             CostCenter AS cost_center, Designation AS designation, Branch AS branch,
             Basic AS basic, HRA AS hra, Gross AS gross, NetSalary AS net_salary,
             CTC AS ctc, EPF AS pf_employee, EPFCompany AS pf_employer,
             ESIC AS esic_employee, ESICCompany AS esic_employer,
             IncomeTax AS income_tax, ProTaxDeduction AS professional_tax,
             WorkingDays AS working_days, EarnedDays AS earned_days,
             SalDate AS sal_date, FinanceYear AS finance_year, FinanceMonth AS finance_month,
             SalaryPaymentMode AS salary_payment_mode
      FROM salary_master_upload ORDER BY DataId LIMIT ${PAGE} OFFSET ${offset}`);
    if (!rows.length) break;
    inserted += await batchInsert(hrms, 'salary_upload_snapshot', rows);
    offset+=rows.length; if(rows.length<PAGE) break;
  }
  log(`  Done. Inserted ${inserted}.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`Connecting HRMS=${HRMS_HOST}  db_bill=${BILL_HOST}${DRY_RUN?' [DRY-RUN]':''}`);
  const hrms = await mysql.createPool({ host:HRMS_HOST, port:3306, user:DB_USER, password:DB_PASS, database:'mas_hrms', connectTimeout:30000, waitForConnections:true, connectionLimit:3 });
  const bill = await mysql.createPool({ host:BILL_HOST, port:3306, user:DB_USER, password:DB_PASS, database:'db_bill',  connectTimeout:30000, waitForConnections:true, connectionLimit:3, dateStrings:true });
  log('Connected.\n');

  try {
    const empMap = await loadEmpMap(hrms);
    log(`Employee map loaded: ${empMap.size} employees.\n`);

    if (!process.argv.includes('--skip-revenue')) { await syncRevenue(bill, hrms); log(''); }
    if (!process.argv.includes('--skip-salary-history')) { await syncSalaryHistory(bill, hrms, empMap); log(''); }
    await syncLeaveGap(bill, hrms, empMap);  log('');
    await syncOdGap(bill, hrms);             log('');
    await syncLoanGap(bill, hrms, empMap);   log('');
    await syncMasjclrGap(bill, hrms);        log('');
    await syncDocsGap(bill, hrms);           log('');
    await syncIncomeTax(bill, hrms);         log('');
    await syncChangeDoj(bill, hrms);         log('');
    await syncEmpMove(bill, hrms);           log('');
    await syncFieldAtt(bill, hrms);          log('');
    await syncQualLeave(bill, hrms);         log('');
    await syncQualAtt(bill, hrms);           log('');
    await syncQualSalary(bill, hrms);        log('');
    await syncSalaryUpload(bill, hrms);

    log('\n══════════════════════════════════════════════');
    log('FINAL COUNTS:');
    const checks = [
      ['bill_revenue_target_snapshot','bill_revenue_target_snapshot'],
      ['bill_revenue_actual_snapshot','bill_revenue_actual_snapshot'],
      ['employee_salary_history','employee_salary_history'],
      ['leave_request','leave_request'],
      ['od_register_snapshot','od_register_snapshot'],
      ['employee_loans','employee_loans'],
      ['legacy_salary_snapshot','legacy_salary_snapshot'],
      ['doc_legacy_snapshot','doc_legacy_snapshot'],
      ['incometax_legacy_snapshot','incometax_legacy_snapshot'],
      ['change_doj_snapshot','change_doj_snapshot'],
      ['employee_move_snapshot','employee_move_snapshot'],
      ['field_attendance_snapshot','field_attendance_snapshot'],
      ['qual_leave_snapshot','qual_leave_snapshot'],
      ['qual_attendance_snapshot','qual_attendance_snapshot'],
      ['qual_salary_snapshot','qual_salary_snapshot'],
      ['salary_upload_snapshot','salary_upload_snapshot'],
    ];
    for (const [label, tbl] of checks) {
      const [[{c}]] = await hrms.execute(`SELECT COUNT(*) c FROM ${tbl}`);
      log(`  ${label.padEnd(35)}: ${c}`);
    }
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
