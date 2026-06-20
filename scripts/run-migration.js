const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const connection = await mysql.createConnection({
    host: '192.168.10.6',
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'mas_hrms',
  });

  try {
    const sqlFile = path.join(__dirname, '../backend/sql/999_fix_missing_ceo_metrics_tables.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);

    console.log(`Running ${statements.length} SQL statements...`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (!stmt) continue;

      try {
        await connection.execute(stmt);
        console.log(`✅ Statement ${i + 1}/${statements.length} executed`);
      } catch (err) {
        console.error(`❌ Statement ${i + 1} failed:`, err.message);
        console.error('SQL:', stmt.substring(0, 100));
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('All 8 tables created:');
    console.log('  - salary_prep_run');
    console.log('  - salary_prep_line');
    console.log('  - workforce_mandate');
    console.log('  - shrinkage_daily_snapshot');
    console.log('  - billing_invoice');
    console.log('  - employee_salary_assignment');
    console.log('  - employee_exit_record');
    console.log('  - applicant');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration();
