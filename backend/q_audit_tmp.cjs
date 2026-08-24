const mysql = require('mysql2/promise');
require('dotenv').config();
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  const [cnt] = await conn.execute('SELECT COUNT(*) AS c FROM payroll_config_flags');
  console.log('COUNT:', JSON.stringify(cnt));
  const [rows] = await conn.execute('SELECT config_key, config_value, branch_id, process_id, updated_at FROM payroll_config_flags ORDER BY config_key, process_id, branch_id');
  console.log('ROWS:', JSON.stringify(rows, null, 1));
  const [dup] = await conn.execute(`SELECT config_key, branch_id, process_id, COUNT(*) c FROM payroll_config_flags GROUP BY config_key, branch_id, process_id HAVING c>1`);
  console.log('DUPES:', JSON.stringify(dup));
  await conn.end();
})().catch(e=>{console.error('ERR', e.message); process.exit(1);});
