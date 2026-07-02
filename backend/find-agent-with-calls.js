import { createConnection } from 'mysql2/promise';

const conn = await createConnection({
  host: '192.168.10.6',
  port: 3306,
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'db_audit',
});

// Find an agent with calls
const [rows] = await conn.execute(`
  SELECT User, COUNT(*) as call_count
  FROM call_quality_assessment
  WHERE Campaign LIKE 'INBOUND%'
    AND CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    AND User IS NOT NULL
    AND User != ''
  GROUP BY User
  ORDER BY call_count DESC
  LIMIT 5
`);

console.log('Top agents with calls:');
rows.forEach(r => console.log(`  ${r.User}: ${r.call_count} calls`));

await conn.end();
