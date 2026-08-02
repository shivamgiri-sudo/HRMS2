/**
 * Delete recent 20 candidate registrations
 */

import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '192.168.10.6',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms'
});

console.log('✓ Connected to database\n');

// Get the 20 most recent candidates
const [candidates] = await connection.execute(`
  SELECT
    candidate_code,
    full_name,
    mobile,
    applied_for_branch,
    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') as registered_at
  FROM ats_candidate
  ORDER BY created_at DESC
  LIMIT 20
`);

console.log('Candidates to be deleted:');
console.log('═'.repeat(100));
console.table(candidates);

console.log(`\nTotal: ${candidates.length} candidates will be deleted.\n`);

// Extract candidate codes
const candidateCodes = candidates.map(c => c.candidate_code);

// Delete the candidates
const [result] = await connection.execute(`
  DELETE FROM ats_candidate
  WHERE candidate_code IN (${candidateCodes.map(() => '?').join(',')})
`, candidateCodes);

console.log('═'.repeat(100));
console.log(`✓ Deleted ${result.affectedRows} candidates`);
console.log('═'.repeat(100));

await connection.end();
