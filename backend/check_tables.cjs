const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: '192.168.10.6', port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'mas_hrms',
  });
  for (const t of ['branch_master','process_master','employees']) {
    const [rows] = await conn.query(`SHOW TABLES LIKE '${t}'`);
    console.log(t, rows.length ? 'EXISTS' : 'MISSING');
    if (rows.length) {
      const [cols] = await conn.query(`SHOW COLUMNS FROM ${t} WHERE Field='id'`);
      console.log('  id column:', JSON.stringify(cols));
    }
  }
  await conn.end();
})();
