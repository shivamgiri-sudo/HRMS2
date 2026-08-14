const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: '192.168.10.6',
    port: 3306,
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'mas_hrms',
  });
  for (const table of ['wfm_rest_policy', 'week_off_policy_default']) {
    try {
      const [rows] = await conn.query(`SHOW COLUMNS FROM ${table}`);
      console.log(`\n=== ${table} ===`);
      rows.forEach(r => console.log(JSON.stringify(r)));
      const [idx] = await conn.query(`SHOW INDEX FROM ${table}`);
      console.log(`--- indexes for ${table} ---`);
      idx.forEach(r => console.log(JSON.stringify({Key_name:r.Key_name, Non_unique:r.Non_unique, Column_name:r.Column_name, Seq_in_index:r.Seq_in_index})));
      const [cnt] = await conn.query(`SELECT COUNT(*) as c FROM ${table}`);
      console.log(`row count: ${cnt[0].c}`);
    } catch (e) {
      console.log(`ERROR for ${table}: ${e.message}`);
    }
  }
  await conn.end();
})();
