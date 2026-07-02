/**
 * Check current branches in database
 * Run: node check-branches.mjs
 */

import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '192.168.10.6',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms'
});

console.log('✓ Connected to database\n');

// Check all branches
const [branches] = await connection.execute(`
  SELECT
    id,
    branch_name,
    branch_code,
    active_status,
    call_centre_code
  FROM branch_master
  ORDER BY active_status DESC, branch_name
`);

console.log('All Branches in Database:');
console.log('═'.repeat(120));
console.table(branches);

// Check existing aliases
const [aliases] = await connection.execute(`
  SELECT
    id,
    canonical_key,
    display_name,
    alias_text,
    active_status
  FROM ats_branch_alias_master
  ORDER BY display_name
`);

console.log('\nExisting Branch Aliases:');
console.log('═'.repeat(120));
if (aliases.length === 0) {
  console.log('(No aliases configured yet)');
} else {
  console.table(aliases);
}

await connection.end();
console.log('\n✓ Done');
