/**
 * Check recent 10 candidate registrations
 * Run: node check-recent-candidates.mjs
 */

import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '192.168.10.6',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms'
});

console.log('✓ Connected to database\n');

const [rows] = await connection.execute(`
  SELECT
    candidate_code,
    full_name,
    mobile,
    applied_for_branch,
    recruiter_name,
    role_applied,
    current_stage,
    sourcing_channel,
    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') as registered_at
  FROM ats_candidate
  ORDER BY created_at DESC
  LIMIT 20
`);

console.log('Recent 10 Candidate Registrations:');
console.log('═'.repeat(120));
console.table(rows);

await connection.end();
console.log('\n✓ Done');
