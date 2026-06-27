import { createConnection } from 'mysql2/promise';

const conn = await createConnection({
  host: '192.168.10.6',
  port: 3306,
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'db_audit',
});

const [rows] = await conn.execute(
  'SELECT COUNT(*) as cnt FROM call_quality_assessment WHERE User = ? AND Campaign LIKE ? LIMIT 1',
  ['EMP-STF-001', 'INBOUND%']
);
console.log('Calls for EMP-STF-001:', rows[0].cnt);

await conn.end();
