const mysql = require('mysql2/promise');
const crypto = require('crypto');

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
    console.log('  SNAPSHOT SYNC — REMAINING PARTS (salary components + documents)');
    console.log('='.repeat(70) + '\n');

    // ════════════════════════════════════════════════════════════════
    // FIX 2c: Populate salary_component_assignments in bulk
    // ════════════════════════════════════════════════════════════════
    console.log('FIX 2c: Populating salary component assignments...');

    // Pull all active bill salary in one query
    const [billSalary] = await bill.query(`
      SELECT EmpCode,
        CAST(bs AS UNSIGNED) AS basic, CAST(hra AS UNSIGNED) AS hra,
        CAST(conv AS UNSIGNED) AS conv, CAST(da AS UNSIGNED) AS da,
        CAST(sa AS UNSIGNED) AS special, CAST(portf AS UNSIGNED) AS portfolio,
        CAST(oa AS UNSIGNED) AS other, CAST(Gross AS UNSIGNED) AS gross,
        CAST(NetInhand AS UNSIGNED) AS net, CAST(CTC AS UNSIGNED) AS ctc,
        CAST(EPFCO AS UNSIGNED) AS epf_emp, CAST(ESICCO AS UNSIGNED) AS esic_emp,
        pfelig, esielig
      FROM masjclrentry
      WHERE CTC IS NOT NULL AND CTC != '' AND CAST(CTC AS UNSIGNED) > 0
    `);
    const billSalMap = new Map(billSalary.map(r => [r.EmpCode, r]));
    console.log(`  Loaded ${billSalary.length} salary records from db_bill`);

    // Pull all HRMS active employees with salary assignment
    const [hrmsEmps] = await hrms.query(`
      SELECT e.id, e.employee_code, COALESCE(e.date_of_joining, CURDATE()) AS eff_date
      FROM employees e
      JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
      WHERE e.active_status = 1
    `);
    console.log(`  Loaded ${hrmsEmps.length} HRMS employees with salary\n  Processing in batches...`);

    let compBatch = [];
    let compCount = 0;
    let compSkipped = 0;

    for (const emp of hrmsEmps) {
      const b = billSalMap.get(emp.employee_code);
      if (!b) { compSkipped++; continue; }

      const sa = (b.special || 0) + (b.da || 0) + (b.portfolio || 0) + (b.other || 0);
      compBatch.push([
        crypto.randomUUID(), emp.id,
        safeDate(emp.eff_date) || new Date().toISOString().slice(0, 10),
        'LEGACY',
        b.basic || 0, b.hra || 0, b.conv || 0, sa, b.gross || 0,
        b.pfelig === 'YES' ? 1 : 0, b.esielig === 'YES' ? 1 : 0,
        b.epf_emp || 0, b.esic_emp || 0,
        b.ctc || 0, b.net || 0
      ]);

      if (compBatch.length >= 200) {
        await hrms.query(`
          INSERT INTO salary_component_assignments
            (id, employee_id, effective_date, salary_slab, basic, hra, conveyance,
             special_allowance, gross, pf_applicable, esi_applicable,
             employer_pf, employer_esi, ctc, net_estimate, status, created_at)
          VALUES ?
          ON DUPLICATE KEY UPDATE
            basic=VALUES(basic), hra=VALUES(hra), conveyance=VALUES(conveyance),
            special_allowance=VALUES(special_allowance), gross=VALUES(gross),
            employer_pf=VALUES(employer_pf), employer_esi=VALUES(employer_esi),
            ctc=VALUES(ctc), net_estimate=VALUES(net_estimate), status='active'
        `, [compBatch.map(r => [...r, 'active', new Date()])]);
        compCount += compBatch.length;
        compBatch = [];
        process.stdout.write(`  ${compCount} components inserted...\r`);
      }
    }

    // Flush remaining
    if (compBatch.length > 0) {
      await hrms.query(`
        INSERT INTO salary_component_assignments
          (id, employee_id, effective_date, salary_slab, basic, hra, conveyance,
           special_allowance, gross, pf_applicable, esi_applicable,
           employer_pf, employer_esi, ctc, net_estimate, status, created_at)
        VALUES ?
        ON DUPLICATE KEY UPDATE
          basic=VALUES(basic), hra=VALUES(hra), conveyance=VALUES(conveyance),
          special_allowance=VALUES(special_allowance), gross=VALUES(gross),
          employer_pf=VALUES(employer_pf), employer_esi=VALUES(employer_esi),
          ctc=VALUES(ctc), net_estimate=VALUES(net_estimate), status='active'
      `, [compBatch.map(r => [...r, 'active', new Date()])]);
      compCount += compBatch.length;
    }

    console.log(`  ✓ ${compCount} salary component records inserted (${compSkipped} skipped - no db_bill match)\n`);

    // ════════════════════════════════════════════════════════════════
    // FIX 3: Import missing documents
    // ════════════════════════════════════════════════════════════════
    console.log('FIX 3: Importing missing documents from db_bill...');

    const [[maxRef]] = await hrms.execute(
      `SELECT COALESCE(MAX(legacy_ref_id), 0) AS max_ref FROM employee_documents WHERE legacy_source = 'document_master'`
    );
    console.log(`  HRMS watermark (max legacy_ref_id): ${maxRef.max_ref}`);

    const [newDocs] = await bill.query(`
      SELECT du.SrNo, du.DocumentType, du.DocumentUploaded, du.DocumentName, du.Status, j.EmpCode
      FROM mas_docoments_upload du
      JOIN masjclrentry j ON j.id = du.EmpSrno
      WHERE du.SrNo > ? AND du.DocumentUploaded IS NOT NULL AND du.DocumentUploaded != ''
        AND j.EmpCode NOT LIKE 'IDC%'
      ORDER BY du.SrNo
    `, [maxRef.max_ref]);
    console.log(`  ${newDocs.length} new documents to import from db_bill\n  Processing...`);

    // Build employee code → id map
    const [empRows] = await hrms.query('SELECT id, employee_code FROM employees');
    const empMap = new Map(empRows.map(r => [r.employee_code, r.id]));

    const docCategoryMap = {
      'POI': 'identity', 'POA': 'address_proof', 'POE': 'education', 'POExp': 'experience',
      'PAN': 'pan', 'Aadhar': 'aadhaar', 'Passport': 'passport', 'DL': 'driving_license',
      'Medical': 'medical', 'CoC': 'contract', 'CF': 'contract',
      'Offer Letter': 'offer_letter', 'Cancelled Cheque Image': 'bank', 'Bank': 'bank',
      'TDS': 'tax', 'PF': 'statutory', 'ESIC': 'statutory'
    };

    let docsBatch = [];
    let docsImported = 0;
    let docsSkipped = 0;

    for (const doc of newDocs) {
      const empId = empMap.get(doc.EmpCode);
      if (!empId) { docsSkipped++; continue; }

      const base = (doc.DocumentType || '').replace(/_\d+$/, '');
      const category = docCategoryMap[base] || docCategoryMap[doc.DocumentType] || 'other';

      docsBatch.push([
        crypto.randomUUID(), empId,
        doc.DocumentType || 'other', category,
        'document_master', doc.SrNo,
        doc.DocumentName || doc.DocumentType || 'Document',
        `legacy://document_master/${doc.DocumentUploaded}`,
        doc.Status === 'Yes' ? 1 : 0
      ]);

      if (docsBatch.length >= 500) {
        await hrms.query(`
          INSERT IGNORE INTO employee_documents
            (id, employee_id, doc_type, doc_category, legacy_source, legacy_ref_id,
             doc_name, file_url, verified)
          VALUES ?
        `, [docsBatch]);
        docsImported += docsBatch.length;
        docsBatch = [];
        process.stdout.write(`  ${docsImported} documents imported...\r`);
      }
    }

    if (docsBatch.length > 0) {
      await hrms.query(`
        INSERT IGNORE INTO employee_documents
          (id, employee_id, doc_type, doc_category, legacy_source, legacy_ref_id,
           doc_name, file_url, verified)
        VALUES ?
      `, [docsBatch]);
      docsImported += docsBatch.length;
    }

    console.log(`  ✓ ${docsImported} documents imported (${docsSkipped} skipped - no HRMS match)\n`);

    // ════════════════════════════════════════════════════════════════
    // Final verification
    // ════════════════════════════════════════════════════════════════
    console.log('Final state:\n');
    const [[t1]] = await hrms.execute('SELECT COUNT(*) AS c FROM employees');
    const [[t2]] = await hrms.execute("SELECT COUNT(*) AS c FROM employees WHERE active_status=1 AND LOWER(COALESCE(employment_status,'active')) NOT IN ('inactive','terminated','offboarded','absconded','resigned','left','separated')");
    const [[t3]] = await hrms.execute("SELECT COUNT(*) AS c FROM employees WHERE active_status=0 OR LOWER(COALESCE(employment_status,'')) IN ('inactive','terminated','offboarded','absconded','resigned','left','separated')");
    const [[t4]] = await hrms.execute("SELECT COUNT(*) AS c FROM employees WHERE employment_status IN ('resigned','terminated','absconded','separated')");
    const [[t5]] = await hrms.execute('SELECT COUNT(*) AS c FROM employee_salary_assignment WHERE active_status=1');
    const [[t6]] = await hrms.execute('SELECT COUNT(*) AS c FROM salary_component_assignments');
    const [[t7]] = await hrms.execute('SELECT COUNT(*) AS c FROM employee_documents');

    console.log(`  Total employees:              ${t1.c}`);
    console.log(`  Active:                       ${t2.c}`);
    console.log(`  Inactive/Left:                ${t3.c}`);
    console.log(`  Employment status mapped:     ${t4.c}`);
    console.log(`  Active salary assignments:    ${t5.c}`);
    console.log(`  Salary component records:     ${t6.c}`);
    console.log(`  Employee documents:           ${t7.c}`);

    console.log('\n' + '='.repeat(70));
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
