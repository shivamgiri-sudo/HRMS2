const mysql = require('mysql2/promise');

async function run() {
  const pool = mysql.createPool({
    host: '122.184.128.90',
    port: 3306,
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'mas_hrms',
    connectionLimit: 5,
    connectTimeout: 15000
  });

  try {
    console.log('Creating backups of critical tables...\n');

    // Backup 1: employees
    console.log('1. Backing up employees table...');
    const [empCols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='employees' AND TABLE_SCHEMA='mas_hrms' AND COLUMN_NAME != 'full_name' ORDER BY ORDINAL_POSITION"
    );
    const empColList = empCols.map(c => `\`${c.COLUMN_NAME}\``).join(',');
    await pool.execute(`DROP TABLE IF EXISTS employees_backup_20260711`);
    await pool.execute(`CREATE TABLE employees_backup_20260711 AS SELECT ${empColList} FROM employees`);
    const [[empCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM employees_backup_20260711');
    console.log(`   ✓ Backed up ${empCount.cnt} employee records\n`);

    // Backup 2: employee_salary_assignment
    console.log('2. Backing up employee_salary_assignment table...');
    await pool.execute('CREATE TABLE IF NOT EXISTS employee_salary_assignment_backup_20260711 LIKE employee_salary_assignment');
    await pool.execute('INSERT INTO employee_salary_assignment_backup_20260711 SELECT * FROM employee_salary_assignment');
    const [[salCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM employee_salary_assignment_backup_20260711');
    console.log(`   ✓ Backed up ${salCount.cnt} salary assignment records\n`);

    // Backup 3: salary_component_assignments
    console.log('3. Backing up salary_component_assignments table...');
    await pool.execute('CREATE TABLE IF NOT EXISTS salary_component_assignments_backup_20260711 LIKE salary_component_assignments');
    await pool.execute('INSERT INTO salary_component_assignments_backup_20260711 SELECT * FROM salary_component_assignments');
    const [[compCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM salary_component_assignments_backup_20260711');
    console.log(`   ✓ Backed up ${compCount.cnt} component assignment records\n`);

    // Backup 4: employee_documents
    console.log('4. Backing up employee_documents table...');
    await pool.execute('CREATE TABLE IF NOT EXISTS employee_documents_backup_20260711 LIKE employee_documents');
    await pool.execute('INSERT INTO employee_documents_backup_20260711 SELECT * FROM employee_documents');
    const [[docCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM employee_documents_backup_20260711');
    console.log(`   ✓ Backed up ${docCount.cnt} document records\n`);

    console.log('━'.repeat(60));
    console.log('✓ All backup tables created:');
    console.log('  - employees_backup_20260711');
    console.log('  - employee_salary_assignment_backup_20260711');
    console.log('  - salary_component_assignments_backup_20260711');
    console.log('  - employee_documents_backup_20260711');
    console.log('━'.repeat(60));
    console.log('\nReady to run snapshot sync.\n');

    await pool.end();
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}

run();
