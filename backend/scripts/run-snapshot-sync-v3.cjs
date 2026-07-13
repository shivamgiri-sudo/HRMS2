const mysql = require('mysql2/promise');
let provisionerPromise;

function getLmsProvisioner() {
  if (!provisionerPromise) {
    provisionerPromise = import('../src/modules/lms/lms-provisioning.service.js');
  }
  return provisionerPromise;
}

function safeDate(val) {
  if (!val || val === '0000-00-00') return null;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch (_) { return null; }
}

async function run() {
  const hrms = await mysql.createConnection({
    host: '122.184.128.90',
    port: 3306,
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'mas_hrms',
    connectTimeout: 15000
  });

  const bill = await mysql.createConnection({
    host: '14.97.30.236',
    port: 3306,
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'db_bill',
    connectTimeout: 15000
  });

  try {
    console.log('\n' + '='.repeat(70));
    console.log('  db_bill → mas_hrms SNAPSHOT SYNC (PRODUCTION)');
    console.log('='.repeat(70) + '\n');

    // ════════════════════════════════════════════════════════════════
    // FIX 1+5: Deactivate left employees + map DOL + set status
    // ════════════════════════════════════════════════════════════════
    console.log('FIX 1+5: Deactivating left employees + mapping DOL...');
    const [leftInBill] = await bill.execute(`
      SELECT EmpCode, DOL, ResignationDate, left_type, LeftReason, Status
      FROM masjclrentry
      WHERE (DOL IS NOT NULL OR Status != '1')
        AND EmpCode NOT LIKE 'IDC%'
        AND EmpCode IS NOT NULL AND EmpCode != ''
    `);

    let updated = 0;
    for (const row of leftInBill) {
      const dol = safeDate(row.DOL);
      const resignDate = safeDate(row.ResignationDate);
      const leftType = row.left_type === 'Voluntary' ? 'resigned' :
                       row.left_type === 'Non Voluntary' ? 'terminated' :
                       row.left_type === 'Absconding' ? 'absconded' :
                       row.left_type ? 'separated' : null;

      await hrms.execute(`
        UPDATE employees SET
          active_status = 0,
          employment_status = COALESCE(NULLIF(employment_status, 'active'), ?),
          date_of_leaving = COALESCE(date_of_leaving, ?),
          date_of_exit = COALESCE(date_of_exit, ?),
          resignation_date = COALESCE(resignation_date, ?)
        WHERE employee_code = ?
      `, [leftType, dol, dol, resignDate, row.EmpCode]);

      updated++;
      if (updated % 500 === 0) process.stdout.write(`  ${updated} employees updated...\r`);
    }
    console.log(`  ✓ ${updated} employees deactivated/updated\n`);

    // ════════════════════════════════════════════════════════════════
    // Deactivate salary assignments for all inactive employees
    // ════════════════════════════════════════════════════════════════
    console.log('Deactivating stale salary assignments...');
    const [sal] = await hrms.execute(`
      UPDATE employee_salary_assignment esa
      JOIN employees e ON e.id = esa.employee_id
      SET esa.active_status = 0
      WHERE e.active_status = 0 AND esa.active_status = 1
    `);
    console.log(`  ✓ ${sal.affectedRows} salary assignments deactivated\n`);

    // ════════════════════════════════════════════════════════════════
    // FIX 2a: Fix CTC mismatches
    // ════════════════════════════════════════════════════════════════
    console.log('FIX 2: Fixing CTC mismatches...');
    const [billSalary] = await bill.execute(`
      SELECT EmpCode, CAST(CTC AS UNSIGNED) AS ctc_monthly
      FROM masjclrentry
      WHERE Status = '1' AND CTC IS NOT NULL AND CTC != '' AND CAST(CTC AS UNSIGNED) > 0
    `);

    let ctcFixed = 0;
    for (const row of billSalary) {
      const [[hrmsEmp]] = await hrms.execute(
        `SELECT esa.id, esa.ctc_annual FROM employee_salary_assignment esa
         JOIN employees e ON e.id = esa.employee_id
         WHERE e.employee_code = ? AND esa.active_status = 1 LIMIT 1`,
        [row.EmpCode]
      );

      if (!hrmsEmp) continue;
      const hrmsMonthly = Math.round(hrmsEmp.ctc_annual / 12);
      if (Math.abs(hrmsMonthly - row.ctc_monthly) > 100) {
        await hrms.execute(`UPDATE employee_salary_assignment SET ctc_annual = ? WHERE id = ?`,
          [row.ctc_monthly * 12, hrmsEmp.id]);
        ctcFixed++;
      }
    }
    console.log(`  ✓ ${ctcFixed} CTC mismatches fixed\n`);

    // ════════════════════════════════════════════════════════════════
    // FIX 2b: Create missing salary assignments
    // ════════════════════════════════════════════════════════════════
    console.log('Creating missing salary assignments...');
    const [allHrms] = await hrms.execute(`
      SELECT e.id, e.employee_code
      FROM employees e
      WHERE e.active_status = 1
      AND NOT EXISTS (
        SELECT 1 FROM employee_salary_assignment esa
        WHERE esa.employee_id = e.id AND esa.active_status = 1
      )
    `);

    let salaryCreated = 0;
    for (const emp of allHrms) {
      const [[billEmp]] = await bill.execute(
        `SELECT CAST(CTC AS UNSIGNED) AS ctc FROM masjclrentry
         WHERE EmpCode = ? AND Status = '1' AND CTC > 0 LIMIT 1`,
        [emp.employee_code]
      );

      if (billEmp && billEmp.ctc > 0) {
        await hrms.execute(`
          INSERT INTO employee_salary_assignment
            (id, employee_id, structure_id, ctc_annual, governance_mode, effective_from, active_status, created_at)
          VALUES (UUID(), ?, '450abc3f-6592-11f1-adb1-00155d0ab410', ?, 'LEGACY_IMPORT', CURDATE(), 1, NOW())
        `, [emp.id, billEmp.ctc * 12]);
        salaryCreated++;
      }
    }
    console.log(`  ✓ ${salaryCreated} missing salary assignments created\n`);

    // ════════════════════════════════════════════════════════════════
    // FIX 2c: Populate salary_component_assignments
    // ════════════════════════════════════════════════════════════════
    console.log('Populating salary component assignments...');
    const [allHrmsWithSal] = await hrms.query(`
      SELECT e.id, e.employee_code
      FROM employees e
      JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
      WHERE e.active_status = 1
    `);

    let componentsPopulated = 0;
    for (const emp of allHrmsWithSal) {
      const [[billEmp]] = await bill.execute(
        `SELECT
          CAST(bs AS UNSIGNED) AS basic, CAST(hra AS UNSIGNED) AS hra,
          CAST(conv AS UNSIGNED) AS conv, CAST(da AS UNSIGNED) AS da,
          CAST(sa AS UNSIGNED) AS special, CAST(portf AS UNSIGNED) AS portfolio,
          CAST(oa AS UNSIGNED) AS other, CAST(Gross AS UNSIGNED) AS gross,
          CAST(NetInhand AS UNSIGNED) AS net, CAST(CTC AS UNSIGNED) AS ctc,
          CAST(EPFCO AS UNSIGNED) AS epf_emp, CAST(ESICCO AS UNSIGNED) AS esic_emp,
          pfelig, esielig
         FROM masjclrentry
         WHERE EmpCode = ? AND Status = '1'`,
        [emp.employee_code]
      );

      if (billEmp) {
        const specialAllowance = (billEmp.special || 0) + (billEmp.da || 0) +
                               (billEmp.portfolio || 0) + (billEmp.other || 0);

        await hrms.execute(`
          INSERT INTO salary_component_assignments
            (id, employee_id, effective_date, salary_slab, basic, hra, conveyance,
             special_allowance, gross, pf_applicable, esi_applicable, employer_pf,
             employer_esi, ctc, net_estimate, status, created_at)
          VALUES (?, ?, CURDATE(), 'LEGACY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW())
          ON DUPLICATE KEY UPDATE
            basic = VALUES(basic), hra = VALUES(hra), conveyance = VALUES(conveyance),
            special_allowance = VALUES(special_allowance), gross = VALUES(gross),
            employer_pf = VALUES(employer_pf), employer_esi = VALUES(employer_esi),
            ctc = VALUES(ctc), net_estimate = VALUES(net_estimate)
        `, [
          require('crypto').randomUUID(), emp.id,
          billEmp.basic || 0, billEmp.hra || 0, billEmp.conv || 0,
          specialAllowance, billEmp.gross || 0,
          billEmp.pfelig === 'YES' ? 1 : 0,
          billEmp.esielig === 'YES' ? 1 : 0,
          billEmp.epf_emp || 0, billEmp.esic_emp || 0,
          billEmp.ctc || 0, billEmp.net || 0
        ]);
        componentsPopulated++;
      }

      if (componentsPopulated % 100 === 0) process.stdout.write(`  ${componentsPopulated} components...\r`);
    }
    console.log(`  ✓ ${componentsPopulated} component records populated\n`);

    // ════════════════════════════════════════════════════════════════
    // FIX 3: Import documents
    // ════════════════════════════════════════════════════════════════
    console.log('Importing documents from db_bill...');
    const [[maxRef]] = await hrms.execute(
      `SELECT COALESCE(MAX(legacy_ref_id), 0) AS max_ref FROM employee_documents WHERE legacy_source = 'document_master'`
    );

    const [newDocs] = await bill.execute(`
      SELECT du.SrNo, du.DocumentType, du.DocumentUploaded, du.DocumentName, du.Status, j.EmpCode
      FROM mas_docoments_upload du
      JOIN masjclrentry j ON j.id = du.EmpSrno
      WHERE du.SrNo > ? AND du.DocumentUploaded IS NOT NULL AND du.DocumentUploaded != ''
      ORDER BY du.SrNo
    `, [maxRef.max_ref]);

    const docCategoryMap = {
      'POI': 'identity', 'POA': 'address_proof', 'POE': 'education',
      'PAN': 'pan', 'Aadhar': 'aadhaar', 'Passport': 'passport',
      'DL': 'driving_license', 'CoC': 'contract', 'CF': 'contract',
      'Offer Letter': 'offer_letter', 'Bank': 'bank', 'TDS': 'tax',
      'PF': 'statutory', 'ESIC': 'statutory'
    };

    let docsImported = 0;
    let docsBatch = [];
    for (const doc of newDocs) {
      const [[empId]] = await hrms.execute('SELECT id FROM employees WHERE employee_code = ? LIMIT 1', [doc.EmpCode]);
      if (!empId) continue;

      const docCategory = docCategoryMap[doc.DocumentType] || 'other';
      docsBatch.push([
        require('crypto').randomUUID(), empId.id, doc.DocumentType || 'other',
        docCategory, 'document_master', doc.SrNo,
        doc.DocumentName || doc.DocumentType || 'Document',
        `legacy://document_master/${doc.DocumentUploaded}`,
        doc.Status === 'Yes' ? 1 : 0
      ]);

      if (docsBatch.length >= 500) {
        await hrms.query(`
          INSERT IGNORE INTO employee_documents
            (id, employee_id, doc_type, doc_category, legacy_source, legacy_ref_id, doc_name, file_url, verified)
          VALUES ?
        `, [docsBatch]);
        docsImported += docsBatch.length;
        docsBatch = [];
        process.stdout.write(`  ${docsImported} documents...\r`);
      }
    }

    if (docsBatch.length > 0) {
      await hrms.query(`
        INSERT IGNORE INTO employee_documents
          (id, employee_id, doc_type, doc_category, legacy_source, legacy_ref_id, doc_name, file_url, verified)
        VALUES ?
      `, [docsBatch]);
      docsImported += docsBatch.length;
    }
    console.log(`  ✓ ${docsImported} documents imported\n`);

    // ════════════════════════════════════════════════════════════════
    // FIX 4: Import new employees
    // ════════════════════════════════════════════════════════════════
    console.log('Importing new employees from db_bill...');
    const [billActive] = await bill.execute(`
      SELECT EmpCode, EmpName, DOJ, DOB, Gendar, MaritalStatus, BloodGruop,
             Mobile, EmailId, OfficeEmailId, Father, PanNo, AdharId,
             AcNo, AcBank, AcBranch, IFSCCode, AccHolder, AccType,
             EPFNo, ESICNo, UAN, CTC, BranchName, Dept, Process,
             Adrress1, Adrress2, City, State, PinCode, BioCode, EmpType, Source
      FROM masjclrentry WHERE Status = '1' AND EmpCode NOT LIKE 'IDC%'
    `);

    const [existingEmps] = await hrms.query('SELECT employee_code FROM employees');
    const existingSet = new Set(existingEmps.map(e => e.employee_code));

    let newEmpsAdded = 0;
    for (const emp of billActive) {
      if (existingSet.has(emp.EmpCode)) continue;

      const nameParts = (emp.EmpName || '').trim().split(/\s+/);
      const firstName = nameParts[0] || 'UNKNOWN';
      const lastName = nameParts.slice(1).join(' ') || '';
      const doj = safeDate(emp.DOJ);
      const dob = safeDate(emp.DOB);
      const gender = emp.Gendar?.toLowerCase() === 'female' ? 'female' :
                     emp.Gendar?.toLowerCase() === 'male' ? 'male' : null;

      const [[branch]] = await hrms.execute(
        'SELECT id FROM branch_master WHERE UPPER(branch_name) = UPPER(?) LIMIT 1',
        [emp.BranchName || '']
      );
      const [[dept]] = await hrms.execute(
        'SELECT id FROM department_master WHERE UPPER(dept_name) = UPPER(?) LIMIT 1',
        [emp.Dept || '']
      );
      const [[proc]] = await hrms.execute(
        'SELECT id FROM process_master WHERE UPPER(process_name) = UPPER(?) LIMIT 1',
        [emp.Process || '']
      );

      const empId = require('crypto').randomUUID();
      await hrms.execute(`
        INSERT INTO employees (
          id, employee_code, first_name, last_name, date_of_joining, date_of_birth,
          gender, marital_status, blood_group, mobile, personal_email, official_email,
          father_name, pan_number, aadhaar_number,
          bank_account_number, bank_name, bank_branch, ifsc_code, account_holder_name, account_type,
          epf_number, esic_number, uan_number,
          branch_id, department_id, process_id, biometric_code,
          address1, address2, city, state, pincode,
          active_status, employment_status, employment_type, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, NOW())
      `, [
        empId, emp.EmpCode, firstName, lastName, doj, dob, gender,
        emp.MaritalStatus || null, emp.BloodGruop || null,
        emp.Mobile || null, emp.EmailId || null, emp.OfficeEmailId || null,
        emp.Father || null, emp.PanNo || null, emp.AdharId || null,
        emp.AcNo || null, emp.AcBank || null, emp.AcBranch || null, emp.IFSCCode || null,
        emp.AccHolder || null, emp.AccType || null,
        emp.EPFNo || null, emp.ESICNo || null, emp.UAN || null,
        branch?.id || null, dept?.id || null, proc?.id || null, emp.BioCode || null,
        emp.Adrress1 || null, emp.Adrress2 || null, emp.City || null, emp.State || null, emp.PinCode || null,
        emp.EmpType || 'ONROLL', emp.Source || null
      ]);

      try {
        const { provisionLmsIdentityForEmployee } = await getLmsProvisioner();
        const lmsResult = await provisionLmsIdentityForEmployee({ employeeCode: String(emp.EmpCode).trim() });
        if (lmsResult.message) {
          console.log(`[Snapshot Sync] LMS provisioning for ${emp.EmpCode}: ${lmsResult.message}`);
        }
      } catch (err) {
        console.warn(
          `[Snapshot Sync] LMS provisioning skipped for ${emp.EmpCode}:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      // Create salary assignment
      const ctcMonthly = Number(emp.CTC) || 0;
      if (ctcMonthly > 0) {
        await hrms.execute(`
          INSERT INTO employee_salary_assignment
            (id, employee_id, structure_id, ctc_annual, governance_mode, effective_from, active_status, created_at)
          VALUES (UUID(), ?, '450abc3f-6592-11f1-adb1-00155d0ab410', ?, 'LEGACY_IMPORT', ?, 1, NOW())
        `, [empId, ctcMonthly * 12, doj || new Date().toISOString().slice(0, 10)]);
      }

      newEmpsAdded++;
      if (newEmpsAdded % 50 === 0) process.stdout.write(`  ${newEmpsAdded} new employees...\r`);
    }
    console.log(`  ✓ ${newEmpsAdded} new employees imported\n`);

    // ════════════════════════════════════════════════════════════════
    // Verify results
    // ════════════════════════════════════════════════════════════════
    console.log('Verifying final state...\n');

    const [[empTotal]] = await hrms.execute('SELECT COUNT(*) AS cnt FROM employees');
    const [[empActive]] = await hrms.execute(
      `SELECT COUNT(*) AS cnt FROM employees
       WHERE active_status = 1
       AND LOWER(COALESCE(employment_status, 'active')) NOT IN ('inactive','terminated','offboarded','absconded','resigned','left','separated')`
    );
    const [[empInactive]] = await hrms.execute(
      `SELECT COUNT(*) AS cnt FROM employees
       WHERE active_status = 0
       OR LOWER(COALESCE(employment_status, '')) IN ('inactive','terminated','offboarded','absconded','resigned','left','separated')`
    );
    const [[salAssign]] = await hrms.execute('SELECT COUNT(*) AS cnt FROM employee_salary_assignment WHERE active_status = 1');
    const [[salComp]] = await hrms.execute('SELECT COUNT(*) AS cnt FROM salary_component_assignments');
    const [[docs_count]] = await hrms.execute('SELECT COUNT(*) AS cnt FROM employee_documents');

    console.log('Final counts:');
    console.log(`  Total employees:              ${empTotal.cnt}`);
    console.log(`  Active employees:             ${empActive.cnt}`);
    console.log(`  Inactive/Left employees:      ${empInactive.cnt}`);
    console.log(`  Active salary assignments:    ${salAssign.cnt}`);
    console.log(`  Salary component records:     ${salComp.cnt}`);
    console.log(`  Employee documents:           ${docs_count.cnt}\n`);

    console.log('='.repeat(70));
    console.log('✓ SNAPSHOT SYNC COMPLETE');
    console.log('='.repeat(70) + '\n');

    await hrms.end();
    await bill.end();
  } catch (e) {
    console.error('\n\nFATAL ERROR:', e.message);
    if (e.sql) console.error('SQL:', e.sql.substring(0, 300));
    process.exit(1);
  }
}

run();
