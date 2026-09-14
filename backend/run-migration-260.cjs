const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: 'mas_hrms',
    multipleStatements: true,
  });

  try {
    console.log('Connected to database');

    const sqlPath = path.join(__dirname, 'sql', '260_employee_external_mappings.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Running migration 260_employee_external_mappings.sql...');
    const [result] = await connection.query(sql);

    console.log('✓ Migration completed successfully');

    // Check results
    const [count] = await connection.execute(
      'SELECT COUNT(*) as total FROM employee_external_mapping WHERE system_name = "ncosec"'
    );
    console.log(`✓ Created ${count[0].total} NCOSEC employee mappings`);

    // Show sample mappings
    const [sample] = await connection.execute(
      `SELECT e.employee_code, em.external_id, em.mapping_source
       FROM employee_external_mapping em
       JOIN employees e ON e.id = em.employee_id
       WHERE em.system_name = 'ncosec'
       LIMIT 5`
    );

    console.log('\nSample mappings:');
    sample.forEach(row => {
      console.log(`  ${row.employee_code} → ${row.external_id} (${row.mapping_source})`);
    });

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration();
