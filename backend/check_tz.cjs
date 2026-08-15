const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: '192.168.10.6', port: 3306, user: 'shivam_user', password: process.env.DB_PASSWORD, database: 'mas_hrms',
  });
  const [tz] = await conn.query("SELECT @@global.time_zone AS gtz, @@session.time_zone AS stz, NOW() AS db_now, CURDATE() AS db_curdate, UTC_TIMESTAMP() AS utc_now");
  console.log(JSON.stringify(tz));
  console.log('node now (UTC iso):', new Date().toISOString());
  console.log('node local:', new Date().toString());
  await conn.end();
})();
