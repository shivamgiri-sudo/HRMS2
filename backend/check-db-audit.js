// Quick check if db_audit.call_quality_assessment exists
import { createConnection } from 'mysql2/promise';

const conn = await createConnection({
  host: '192.168.10.6',
  port: 3306,
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'db_audit',
});

try {
  const [rows] = await conn.execute('SELECT COUNT(*) as cnt FROM call_quality_assessment LIMIT 1');
  console.log('✓ db_audit.call_quality_assessment exists, rows:', rows[0].cnt);
} catch (err) {
  console.error('✗ db_audit.call_quality_assessment NOT accessible:', err.message);
} finally {
  await conn.end();
}
