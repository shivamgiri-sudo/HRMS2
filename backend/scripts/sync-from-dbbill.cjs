/**
 * Sync script: db_bill (source of truth) → mas_hrms
 *
 * Fixes:
 * 1. Mark 180 employees as inactive/left who are active in HRMS but Status=0 in db_bill
 * 2. Fix 20 CTC mismatches in employee_salary_assignment
 * 3. Create 15 missing salary assignments from db_bill
 * 4. Import 134,490 missing documents from mas_docoments_upload
 *
 * Usage: node scripts/sync-from-dbbill.js [--dry-run] [--fix-status] [--fix-salary] [--fix-docs] [--all]
 */

const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');

// Load env from backend/.env
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const FIX_STATUS = process.argv.includes('--fix-status') || process.argv.includes('--all');
const FIX_SALARY = process.argv.includes('--fix-salary') || process.argv.includes('--all');
const FIX_DOCS = process.argv.includes('--fix-docs') || process.argv.includes('--all');
const FIX_NEW_EMPS = process.argv.includes('--fix-new-emps') || process.argv.includes('--all');
const FIX_LEFT = process.argv.includes('--fix-left') || process.argv.includes('--all');

if (!FIX_STATUS && !FIX_SALARY && !FIX_DOCS && !FIX_NEW_EMPS && !FIX_LEFT) {
  console.log('Usage: node scripts/sync-from-dbbill.cjs [--dry-run] [--fix-status] [--fix-salary] [--fix-docs] [--fix-new-emps] [--fix-left] [--all]');
  console.log('  --dry-run      Show what would change without writing');
  console.log('  --fix-status   Mark wrongly-active employees as inactive');
  console.log('  --fix-salary   Fix CTC mismatches and create missing salary assignments');
  console.log('  --fix-docs     Import missing documents from db_bill');
  console.log('  --fix-new-emps Import employees from db_bill not yet in HRMS');
  console.log('  --fix-left     Map DOL, left type, reason for all left employees; deactivate stale salary');
  console.log('  --all          Do all fixes');
  process.exit(0);
}

function uuid() {
  return crypto.randomUUID();
}

const DOC_TYPE_CATEGORY_MAP = {
  'POI': 'identity',
  'POA': 'address_proof',
  'POE': 'education',
  'POExp': 'experience',
  'PAN': 'pan',
  'Aadhar': 'aadhaar',
  'Passport': 'passport',
  'DL': 'driving_license',
  'Medical': 'medical',
  'CoC': 'contract',
  'CF': 'contract',
  'Offer Letter': 'offer_letter',
  'Cancelled Cheque Image': 'bank',
  'Bank': 'bank',
  'TDS': 'tax',
  'PF': 'statutory',
  'ESIC': 'statutory',
  'Resume': 'other',
  'Photo': 'other',
};

function safeDate(val) {
  if (!val) return null;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch (_) { return null; }
}

function mapDocCategory(docType) {
  if (!docType) return 'other';
  const base = docType.replace(/_\d+$/, '');
  return DOC_TYPE_CATEGORY_MAP[base] || DOC_TYPE_CATEGORY_MAP[docType] || 'other';
}

async function run() {
  const hrmsPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5,
    timezone: '+05:30',
  });
  const billPool = mysql.createPool({
    host: process.env.BILL_DB_HOST,
    port: Number(process.env.BILL_DB_PORT) || 3306,
    user: process.env.BILL_DB_USER,
    password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
    connectionLimit: 5,
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  db_bill → mas_hrms SYNC ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`${'='.repeat(60)}\n`);

  // ═══════════════════════════════════════════════════════════════
  // 1. FIX EMPLOYEE ACTIVE STATUS
  // ═══════════════════════════════════════════════════════════════
  if (FIX_STATUS) {
    console.log('\n── FIX 1: Employee Active Status ──\n');

    const [leftInBill] = await billPool.query(`
      SELECT EmpCode, EmpName, DOL, Status, left_type, LeftReason, ResignationDate
      FROM masjclrentry
      WHERE (DOL IS NOT NULL OR Status != '1')
      AND EmpCode IS NOT NULL AND EmpCode != ''
    `);

    const [activeHrms] = await hrmsPool.query(`
      SELECT id, employee_code, first_name, last_name FROM employees WHERE active_status = 1
    `);
    const activeMap = new Map(activeHrms.map(r => [r.employee_code, r]));

    const wronglyActive = leftInBill.filter(b => activeMap.has(b.EmpCode));
    console.log(`Found ${wronglyActive.length} employees active in HRMS but left/inactive in db_bill`);

    let statusFixed = 0;
    for (const bill of wronglyActive) {
      const hrmsEmp = activeMap.get(bill.EmpCode);
      const dol = safeDate(bill.DOL);
      const leftType = bill.left_type === 'Voluntary' ? 'resigned' :
                       bill.left_type === 'Non Voluntary' ? 'terminated' : 'separated';
      const reason = bill.LeftReason || bill.left_type || 'Left per legacy system';

      if (DRY_RUN) {
        if (statusFixed < 10) console.log(`  Would deactivate: ${bill.EmpCode} ${bill.EmpName} → ${leftType} (${reason})`);
        statusFixed++;
        continue;
      }

      await hrmsPool.execute(`
        UPDATE employees SET
          active_status = 0,
          employment_status = ?,
          date_of_leaving = COALESCE(?, date_of_leaving),
          date_of_exit = COALESCE(?, date_of_exit)
        WHERE id = ?
      `, [leftType, dol, dol, hrmsEmp.id]);

      // Also deactivate salary assignment
      await hrmsPool.execute(`
        UPDATE employee_salary_assignment SET active_status = 0
        WHERE employee_id = ? AND active_status = 1
      `, [hrmsEmp.id]);

      statusFixed++;
    }
    console.log(`${DRY_RUN ? 'Would fix' : 'Fixed'}: ${statusFixed} employees\n`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. FIX SALARY STRUCTURES
  // ═══════════════════════════════════════════════════════════════
  if (FIX_SALARY) {
    console.log('\n── FIX 2: Salary Structure Sync ──\n');

    // Get HRMS salary assignments
    const [hrmsAssignments] = await hrmsPool.query(`
      SELECT esa.id, esa.employee_id, esa.ctc_annual, e.employee_code
      FROM employee_salary_assignment esa
      JOIN employees e ON e.id = esa.employee_id
      WHERE esa.active_status = 1
    `);

    // Get db_bill salary data (active employees only)
    const [billSalary] = await billPool.query(`
      SELECT EmpCode, CAST(CTC AS UNSIGNED) AS ctc_monthly,
             CAST(bs AS UNSIGNED) AS basic, CAST(hra AS UNSIGNED) AS hra,
             CAST(conv AS UNSIGNED) AS conv, CAST(sa AS UNSIGNED) AS special,
             CAST(da AS UNSIGNED) AS da, CAST(portf AS UNSIGNED) AS portfolio,
             CAST(oa AS UNSIGNED) AS other_allow,
             CAST(Gross AS UNSIGNED) AS gross, CAST(NetInhand AS UNSIGNED) AS net_inhand,
             CAST(EPF AS UNSIGNED) AS epf_emp, CAST(ESIC AS UNSIGNED) AS esic_emp,
             CAST(EPFCO AS UNSIGNED) AS epf_employer, CAST(ESICCO AS UNSIGNED) AS esic_employer,
             pfelig, esielig
      FROM masjclrentry
      WHERE Status = '1' AND CTC IS NOT NULL AND CTC != '' AND CAST(CTC AS UNSIGNED) > 0
    `);
    const billMap = new Map(billSalary.map(r => [r.EmpCode, r]));

    // Fix CTC mismatches
    const hrmsMap = new Map(hrmsAssignments.map(r => [r.employee_code, r]));
    let ctcFixed = 0;
    let ctcSkipped = 0;

    for (const [code, hrms] of hrmsMap) {
      const bill = billMap.get(code);
      if (!bill) continue;
      const hrmsMonthly = Math.round(Number(hrms.ctc_annual) / 12);
      const diff = Math.abs(hrmsMonthly - bill.ctc_monthly);
      if (diff <= 100) continue; // Match

      const correctAnnual = bill.ctc_monthly * 12;

      if (DRY_RUN) {
        if (ctcFixed < 10) console.log(`  Would fix CTC: ${code} | ${hrmsMonthly}/mo → ${bill.ctc_monthly}/mo (annual: ${correctAnnual})`);
        ctcFixed++;
        continue;
      }

      await hrmsPool.execute(`
        UPDATE employee_salary_assignment SET ctc_annual = ? WHERE id = ?
      `, [correctAnnual, hrms.id]);
      ctcFixed++;
    }
    console.log(`CTC mismatches ${DRY_RUN ? 'to fix' : 'fixed'}: ${ctcFixed}`);

    // Create missing salary assignments (employees in db_bill with salary but no HRMS assignment)
    const [allActiveHrms] = await hrmsPool.query(`
      SELECT e.id, e.employee_code
      FROM employees e
      WHERE e.active_status = 1
      AND NOT EXISTS (SELECT 1 FROM employee_salary_assignment esa WHERE esa.employee_id = e.id AND esa.active_status = 1)
    `);

    let salaryCreated = 0;
    for (const emp of allActiveHrms) {
      const bill = billMap.get(emp.employee_code);
      if (!bill || bill.ctc_monthly <= 0) continue;

      const annualCTC = bill.ctc_monthly * 12;
      if (DRY_RUN) {
        if (salaryCreated < 10) console.log(`  Would create salary: ${emp.employee_code} → ₹${bill.ctc_monthly}/mo (₹${annualCTC}/yr)`);
        salaryCreated++;
        continue;
      }

      await hrmsPool.execute(`
        INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, governance_mode, effective_from, active_status, created_at)
        VALUES (UUID(), ?, '450abc3f-6592-11f1-adb1-00155d0ab410', ?, 'LEGACY_IMPORT', CURDATE(), 1, NOW())
      `, [emp.id, annualCTC]);
      salaryCreated++;
    }
    console.log(`Missing salary assignments ${DRY_RUN ? 'to create' : 'created'}: ${salaryCreated}`);

    // Populate salary_component_assignments for ALL employees from db_bill
    const [allHrmsWithSalary] = await hrmsPool.query(`
      SELECT e.id AS employee_id, e.employee_code
      FROM employees e
      JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
      WHERE e.active_status = 1
    `);

    let componentsPopulated = 0;
    for (const emp of allHrmsWithSalary) {
      const bill = billMap.get(emp.employee_code);
      if (!bill || bill.ctc_monthly <= 0) continue;

      if (DRY_RUN) {
        componentsPopulated++;
        continue;
      }

      await hrmsPool.execute(`
        INSERT INTO salary_component_assignments
          (id, employee_id, effective_date, salary_slab, basic, hra, conveyance, special_allowance, gross,
           pf_applicable, esi_applicable, employer_pf, employer_esi, ctc, net_estimate, status, created_at)
        VALUES (?, ?, CURDATE(), 'LEGACY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW())
        ON DUPLICATE KEY UPDATE
          basic = VALUES(basic), hra = VALUES(hra), conveyance = VALUES(conveyance),
          special_allowance = VALUES(special_allowance), gross = VALUES(gross),
          employer_pf = VALUES(employer_pf), employer_esi = VALUES(employer_esi),
          ctc = VALUES(ctc), net_estimate = VALUES(net_estimate), status = 'active'
      `, [
        uuid(), emp.employee_id,
        bill.basic, bill.hra, bill.conv,
        bill.special + bill.da + bill.portfolio + bill.other_allow,
        bill.gross,
        bill.pfelig === 'YES' ? 1 : 0,
        bill.esielig === 'YES' ? 1 : 0,
        bill.epf_employer, bill.esic_employer,
        bill.ctc_monthly, bill.net_inhand,
      ]);
      componentsPopulated++;
    }
    console.log(`Component breakdowns ${DRY_RUN ? 'to populate' : 'populated'}: ${componentsPopulated}\n`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. FIX DOCUMENTS
  // ═══════════════════════════════════════════════════════════════
  if (FIX_DOCS) {
    console.log('\n── FIX 3: Document Import ──\n');

    // Get max legacy_ref_id already in HRMS
    const [[maxRef]] = await hrmsPool.query(
      `SELECT COALESCE(MAX(legacy_ref_id), 0) AS max_ref FROM employee_documents WHERE legacy_source = 'document_master'`
    );
    console.log(`HRMS max legacy_ref_id: ${maxRef.max_ref}`);

    // Get newer docs from db_bill
    const [newDocs] = await billPool.query(`
      SELECT du.SrNo, du.EmpSrno, du.DocumentType, du.DocumentUploaded, du.DocumentName, du.Status,
             j.EmpCode
      FROM mas_docoments_upload du
      JOIN masjclrentry j ON j.id = du.EmpSrno
      WHERE du.SrNo > ?
      AND du.DocumentUploaded IS NOT NULL AND du.DocumentUploaded != ''
      ORDER BY du.SrNo
    `, [maxRef.max_ref]);
    console.log(`Documents in db_bill newer than HRMS: ${newDocs.length}`);

    // Get employee_code -> employee_id mapping
    const [empMapping] = await hrmsPool.query(`SELECT id, employee_code FROM employees`);
    const empMap = new Map(empMapping.map(r => [r.employee_code, r.id]));

    let docsImported = 0;
    let docsSkipped = 0;
    const BATCH_SIZE = 500;
    let batch = [];

    for (const doc of newDocs) {
      const employeeId = empMap.get(doc.EmpCode);
      if (!employeeId) { docsSkipped++; continue; }

      const docCategory = mapDocCategory(doc.DocumentType);
      const fileUrl = `legacy://document_master/${doc.DocumentUploaded}`;

      batch.push([
        uuid(), employeeId, doc.DocumentType || 'other', docCategory,
        'document_master', doc.SrNo, doc.DocumentName || doc.DocumentType || 'Document',
        fileUrl, doc.Status === 'Yes' ? 1 : 0
      ]);

      if (batch.length >= BATCH_SIZE) {
        if (!DRY_RUN) {
          await hrmsPool.query(`
            INSERT IGNORE INTO employee_documents
              (id, employee_id, doc_type, doc_category, legacy_source, legacy_ref_id, doc_name, file_url, verified)
            VALUES ?
          `, [batch]);
        }
        docsImported += batch.length;
        batch = [];
        if (docsImported % 10000 === 0) process.stdout.write(`  ${docsImported} imported...\r`);
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      if (!DRY_RUN) {
        await hrmsPool.query(`
          INSERT IGNORE INTO employee_documents
            (id, employee_id, doc_type, doc_category, legacy_source, legacy_ref_id, doc_name, file_url, verified)
          VALUES ?
        `, [batch]);
      }
      docsImported += batch.length;
    }

    console.log(`Documents ${DRY_RUN ? 'to import' : 'imported'}: ${docsImported}`);
    console.log(`Skipped (no matching employee): ${docsSkipped}\n`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. IMPORT NEW EMPLOYEES (in db_bill but not in HRMS)
  // ═══════════════════════════════════════════════════════════════
  if (FIX_NEW_EMPS) {
    console.log('\n── FIX 4: Import New Employees from db_bill ──\n');

    const [billActive] = await billPool.query(`
      SELECT id AS bill_id, EmpCode, EmpName, EmpType, DOJ, DOB, BranchName, Dept, Desgination,
             Process, CostCenter, Mobile, Mobile1, OfficeEmailId, EmailId,
             Father, Husband, Gendar, MaritalStatus, BloodGruop, Qualification,
             PanNo, AdharId, AcNo, AcBank, AcBranch, IFSCCode, AccHolder, AccType,
             EPFNo, ESICNo, UAN, CTC, Gross, NetInhand,
             CAST(bs AS UNSIGNED) AS basic, CAST(hra AS UNSIGNED) AS hra,
             CAST(conv AS UNSIGNED) AS conv, CAST(sa AS UNSIGNED) AS special,
             CAST(da AS UNSIGNED) AS da, CAST(portf AS UNSIGNED) AS portfolio,
             CAST(Gross AS UNSIGNED) AS gross_num, CAST(NetInhand AS UNSIGNED) AS net_num,
             CAST(EPF AS UNSIGNED) AS epf_emp, CAST(ESIC AS UNSIGNED) AS esic_emp,
             CAST(EPFCO AS UNSIGNED) AS epf_employer, CAST(ESICCO AS UNSIGNED) AS esic_employer,
             pfelig, esielig, Adrress1, Adrress2, City, State, PinCode, BioCode,
             NomineeName, NomineeRelation, NomineeDob, Source, Band
      FROM masjclrentry WHERE Status = '1'
    `);

    const [hrmsAll] = await hrmsPool.query('SELECT employee_code FROM employees');
    const hrmsSet = new Set(hrmsAll.map(r => r.employee_code));

    // Never import IDC-prefixed employee codes
    const notInHrms = billActive.filter(b => !hrmsSet.has(b.EmpCode) && !b.EmpCode?.startsWith('IDC'));
    console.log(`Active in db_bill but NOT in HRMS (excl. IDC): ${notInHrms.length}`);

    // Get branch/dept/process mappings from HRMS
    const [branches] = await hrmsPool.query('SELECT id, branch_name FROM branch_master');
    const branchMap = new Map(branches.map(b => [b.branch_name?.toUpperCase(), b.id]));

    const [departments] = await hrmsPool.query('SELECT id, dept_name FROM department_master');
    const deptMap = new Map(departments.map(d => [d.dept_name?.toUpperCase(), d.id]));

    const [processes] = await hrmsPool.query('SELECT id, process_name FROM process_master');
    const processMap = new Map(processes.map(p => [p.process_name?.toUpperCase(), p.id]));

    let imported = 0;
    for (const emp of notInHrms) {
      const nameParts = (emp.EmpName || '').trim().split(/\s+/);
      const firstName = nameParts[0] || 'UNKNOWN';
      const lastName = nameParts.slice(1).join(' ') || '';
      const doj = safeDate(emp.DOJ);
      const dob = safeDate(emp.DOB);
      const gender = (emp.Gendar || '').toLowerCase() === 'female' ? 'female' :
                     (emp.Gendar || '').toLowerCase() === 'male' ? 'male' : null;
      const branchId = branchMap.get((emp.BranchName || '').toUpperCase()) || null;
      const deptId = deptMap.get((emp.Dept || '').toUpperCase()) || null;
      const processId = processMap.get((emp.Process || '').toUpperCase()) || null;

      if (DRY_RUN) {
        if (imported < 15) console.log(`  Would import: ${emp.EmpCode} | ${emp.EmpName} | DOJ: ${doj} | ${emp.BranchName} | ${emp.Dept}`);
        imported++;
        continue;
      }

      const empId = uuid();
      const ctcMonthly = Number(emp.CTC) || 0;
      await hrmsPool.execute(`
        INSERT INTO employees (
          id, employee_code, first_name, last_name, date_of_joining, date_of_birth,
          gender, marital_status, blood_group,
          mobile, personal_email, official_email,
          father_name,
          pan_number, aadhaar_number,
          bank_account_number, bank_name, bank_branch, ifsc_code, account_holder_name, account_type,
          epf_number, esic_number, uan_number,
          branch_id, department_id, process_id,
          biometric_code,
          address1, address2, city, state, pincode,
          active_status, employment_status, employment_type,
          source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, NOW())
      `, [
        empId, emp.EmpCode, firstName, lastName, doj, dob,
        gender, emp.MaritalStatus || null, emp.BloodGruop || null,
        emp.Mobile || null, emp.EmailId || null, emp.OfficeEmailId || null,
        emp.Father || null,
        emp.PanNo || null, emp.AdharId || null,
        emp.AcNo || null, emp.AcBank || null, emp.AcBranch || null, emp.IFSCCode || null, emp.AccHolder || null, emp.AccType || null,
        emp.EPFNo || null, emp.ESICNo || null, emp.UAN || null,
        branchId, deptId, processId,
        emp.BioCode || null,
        emp.Adrress1 || null, emp.Adrress2 || null, emp.City || null, emp.State || null, emp.PinCode || null,
        emp.EmpType || 'ONROLL', emp.Source || null,
      ]);

      // Create salary assignment if CTC > 0
      if (ctcMonthly > 0) {
        await hrmsPool.execute(`
          INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, governance_mode, effective_from, active_status, created_at)
          VALUES (UUID(), ?, '450abc3f-6592-11f1-adb1-00155d0ab410', ?, 'LEGACY_IMPORT', COALESCE(?, CURDATE()), 1, NOW())
        `, [empId, ctcMonthly * 12, doj]);

        // Component breakdown
        const sa = (emp.special || 0) + (emp.da || 0) + (emp.portfolio || 0);
        await hrmsPool.execute(`
          INSERT INTO salary_component_assignments
            (id, employee_id, effective_date, salary_slab, basic, hra, conveyance, special_allowance, gross,
             pf_applicable, esi_applicable, employer_pf, employer_esi, ctc, net_estimate, status, created_at)
          VALUES (?, ?, COALESCE(?, CURDATE()), 'LEGACY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW())
        `, [
          uuid(), empId, doj,
          emp.basic || 0, emp.hra || 0, emp.conv || 0, sa,
          emp.gross_num || 0,
          emp.pfelig === 'YES' ? 1 : 0, emp.esielig === 'YES' ? 1 : 0,
          emp.epf_employer || 0, emp.esic_employer || 0,
          ctcMonthly, emp.net_num || 0,
        ]);
      }

      imported++;
      if (imported % 50 === 0) process.stdout.write(`  ${imported} imported...\r`);
    }
    console.log(`Employees ${DRY_RUN ? 'to import' : 'imported'}: ${imported}\n`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. MAP LEFT DATE + DEACTIVATE STALE SALARY FOR LEFT EMPLOYEES
  // ═══════════════════════════════════════════════════════════════
  if (FIX_LEFT) {
    console.log('\n── FIX 5: Map DOL + deactivate stale salary for left employees ──\n');

    // Pull all left employees from db_bill with full exit details
    const [billLeft] = await billPool.query(`
      SELECT EmpCode, EmpName,
             DOL, ResignationDate, left_type, LeftReason,
             Status
      FROM masjclrentry
      WHERE (DOL IS NOT NULL OR Status != '1')
        AND EmpCode IS NOT NULL AND EmpCode != ''
        AND EmpCode NOT LIKE 'IDC%'
    `);

    // Pull matching HRMS employees (inactive only — we already fixed active ones)
    const [hrmsLeft] = await hrmsPool.query(`
      SELECT id, employee_code, employment_status, date_of_leaving, date_of_exit
      FROM employees
      WHERE active_status = 0
        AND employee_code IS NOT NULL
    `);
    const hrmsMap = new Map(hrmsLeft.map(r => [r.employee_code, r]));

    let dolFixed = 0;
    let statusFixed = 0;
    let salaryDeactivated = 0;
    let skipped = 0;

    for (const bill of billLeft) {
      const hrms = hrmsMap.get(bill.EmpCode);
      if (!hrms) { skipped++; continue; }

      const dol = safeDate(bill.DOL);
      const resignDate = safeDate(bill.ResignationDate);

      const leftType = bill.left_type === 'Voluntary' ? 'resigned' :
                       bill.left_type === 'Non Voluntary' ? 'terminated' :
                       bill.left_type === 'Absconding' ? 'absconded' :
                       bill.left_type ? 'separated' : null;

      const needsDol = !hrms.date_of_leaving && !hrms.date_of_exit && dol;
      const needsStatus = leftType && hrms.employment_status !== leftType;

      if (!needsDol && !needsStatus) continue;

      if (DRY_RUN) {
        if (dolFixed + statusFixed < 10) {
          console.log(`  ${bill.EmpCode} ${bill.EmpName}: DOL=${dol} type=${leftType} reason=${bill.LeftReason || '-'}`);
        }
        if (needsDol) dolFixed++;
        if (needsStatus) statusFixed++;
        continue;
      }

      await hrmsPool.execute(`
        UPDATE employees SET
          date_of_leaving    = COALESCE(date_of_leaving, ?),
          date_of_exit       = COALESCE(date_of_exit, ?),
          employment_status  = COALESCE(NULLIF(employment_status, 'active'), ?, employment_status),
          resignation_date   = COALESCE(resignation_date, ?)
        WHERE id = ?
      `, [dol, dol, leftType, resignDate, hrms.id]);

      if (needsDol) dolFixed++;
      if (needsStatus) statusFixed++;
    }

    // Deactivate salary assignments for all inactive employees
    if (!DRY_RUN) {
      const [salResult] = await hrmsPool.execute(`
        UPDATE employee_salary_assignment esa
        JOIN employees e ON e.id = esa.employee_id
        SET esa.active_status = 0
        WHERE e.active_status = 0 AND esa.active_status = 1
      `);
      salaryDeactivated = salResult.affectedRows;
    } else {
      const [[salCount]] = await hrmsPool.query(`
        SELECT COUNT(*) AS cnt FROM employee_salary_assignment esa
        JOIN employees e ON e.id = esa.employee_id
        WHERE e.active_status = 0 AND esa.active_status = 1
      `);
      salaryDeactivated = salCount.cnt;
    }

    console.log(`DOL mapped:              ${dolFixed}`);
    console.log(`Employment status fixed: ${statusFixed}`);
    console.log(`Salary deactivated:      ${salaryDeactivated}`);
    console.log(`No HRMS match (skipped): ${skipped}\n`);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SYNC ${DRY_RUN ? 'PREVIEW' : 'COMPLETE'}`);
  console.log(`${'='.repeat(60)}\n`);

  await hrmsPool.end();
  await billPool.end();
}

run().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
