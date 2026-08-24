const mysql = require('mysql2/promise');
require('dotenv').config();
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  const [ddl] = await conn.execute('SHOW CREATE TABLE payroll_config_flags');
  console.log(ddl[0]['Create Table']);
  await conn.end();
})().catch(e=>{console.error('ERR', e.message); process.exit(1);});
