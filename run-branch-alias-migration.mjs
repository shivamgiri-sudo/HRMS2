/**
 * Run Branch Alias Migration
 * Executes backend/sql/999_branch_alias_setup.sql
 */

import mysql from 'mysql2/promise';
import fs from 'fs/promises';

const connection = await mysql.createConnection({
  host: '192.168.10.6',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms',
  multipleStatements: true
});

console.log('✓ Connected to database\n');

// Read the SQL file
const sql = await fs.readFile('./backend/sql/999_branch_alias_setup.sql', 'utf8');

console.log('Running branch alias migration...\n');
console.log('═'.repeat(80));

try {
  // Execute the migration
  const [results] = await connection.query(sql);

  // The last result set should be the verification SELECT
  const verifyResults = Array.isArray(results) ? results[results.length - 1] : results;

  console.log('\n✓ Migration completed successfully!\n');
  console.log('Verification:');
  console.log('═'.repeat(80));
  console.table(verifyResults);

  console.log('\n✓ Branch aliases are now active!');
  console.log('\nTest at: https://mcnhrms.teammas.in/interview-registration');
  console.log('\nExpected dropdown options:');
  console.log('  - Okaya (submits as NOIDA-2)');
  console.log('  - Trapezoid (submits as NOIDA)');
  console.log('  - Jaldarshan (submits as AHMEDABAD-JALDARSHAN)');

} catch (error) {
  console.error('\n✗ Migration failed!');
  console.error(error.message);
  process.exit(1);
}

await connection.end();
