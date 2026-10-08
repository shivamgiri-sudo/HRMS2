const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: '192.168.10.6', port: 3306, user: 'shivam_user', password: process.env.DB_PASSWORD, database: 'mas_hrms',
  });
  const [rows] = await conn.query(`
    SELECT COLUMN_NAME, GENERATION_EXPRESSION
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='wfm_rest_policy' AND COLUMN_NAME='effective_to_bound'`);
  console.log(JSON.stringify(rows, null, 2));
  await conn.end();
})();
