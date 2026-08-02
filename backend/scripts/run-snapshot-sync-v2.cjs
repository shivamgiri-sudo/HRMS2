const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function run() {
  const conn = await mysql.createConnection({
    host: '122.184.128.90',
    port: 3306,
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'mas_hrms',
    connectTimeout: 15000,
    multipleStatements: true
  });

  try {
    console.log('\n' + '='.repeat(70));
    console.log('  db_bill → mas_hrms SNAPSHOT SYNC (PRODUCTION)');
    console.log('='.repeat(70) + '\n');

    // Read SQL file
    const sqlFile = path.join(__dirname, 'dbbill-snapshot-sync.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    console.log('Executing snapshot sync SQL...\n');
    console.log('This will:');
    console.log('  1. Deactivate left employees + map DOL/status');
    console.log('  2. Fix CTC mismatches + create missing salary assignments');
    console.log('  3. Populate salary component breakdowns');
    console.log('  4. Deactivate stale salary for inactive employees');
    console.log('  5. Import missing documents from db_bill');
    console.log('  6. Import new employees (non-IDC only)');
    console.log('  7. Create salary assignments for new employees\n');

    console.log('Starting...\n');

    const results = await conn.query(sql);

    console.log(`✓ SQL executed successfully\n`);

    // Close and reconnect to get fresh data
    await conn.end();
    const conn2 = await mysql.createConnection({
      host: '122.184.128.90',
      port: 3306,
      user: 'shivam_user',
      password: 'qwersdfg!@#hjk',
      database: 'mas_hrms'
    });

    // Verify results
    console.log('Verifying results...\n');

    const [[empTotal]] = await conn2.execute('SELECT COUNT(*) AS cnt FROM employees');
    const [[empActive]] = await conn2.execute(
      `SELECT COUNT(*) AS cnt FROM employees
       WHERE active_status = 1
       AND LOWER(COALESCE(employment_status, 'active')) NOT IN ('inactive','terminated','offboarded','absconded','resigned','left','separated')`
    );
    const [[empInactive]] = await conn2.execute(
      `SELECT COUNT(*) AS cnt FROM employees
       WHERE active_status = 0
       OR LOWER(COALESCE(employment_status, '')) IN ('inactive','terminated','offboarded','absconded','resigned','left','separated')`
    );
    const [[salAssign]] = await conn2.execute('SELECT COUNT(*) AS cnt FROM employee_salary_assignment WHERE active_status = 1');
    const [[salComp]] = await conn2.execute('SELECT COUNT(*) AS cnt FROM salary_component_assignments');
    const [[docs]] = await conn2.execute('SELECT COUNT(*) AS cnt FROM employee_documents');

    console.log('Final counts:');
    console.log(`  Total employees:              ${empTotal.cnt}`);
    console.log(`  Active employees:             ${empActive.cnt}`);
    console.log(`  Inactive/Left employees:      ${empInactive.cnt}`);
    console.log(`  Active salary assignments:    ${salAssign.cnt}`);
    console.log(`  Salary component records:     ${salComp.cnt}`);
    console.log(`  Employee documents:           ${docs.cnt}\n`);

    console.log('='.repeat(70));
    console.log('✓ SNAPSHOT SYNC COMPLETE');
    console.log('='.repeat(70) + '\n');

    await conn2.end();
  } catch (e) {
    console.error('\n\nFATAL ERROR:', e.message);
    if (e.sql) console.error('SQL:', e.sql.substring(0, 200));
    process.exit(1);
  }
}

run();
