const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: '192.168.10.6', port: 3306, user: 'shivam_user',
      password: 'qwersdfg!@#hjk', database: 'mas_hrms', connectTimeout: 5000
    });

    // Find auth tables
    const [tables] = await conn.execute("SHOW TABLES LIKE '%auth%'");
    console.log('=== AUTH TABLES ===');
    tables.forEach(t => console.log(Object.values(t)[0]));

    // Check auth table columns
    for (const tbl of tables) {
      const name = Object.values(tbl)[0];
      if (name !== 'stg_legacy_attendance') {
        const [cols] = await conn.execute('SHOW COLUMNS FROM '+name);
        console.log('\n'+name+' columns:');
        cols.forEach(c => console.log('  '+c.Field+' ('+c.Type+')'));
        if (name !== 'auth_users') continue;
        const [data] = await conn.execute("SELECT id, email, role FROM "+name+" LIMIT 5");
        console.log('Sample:');
        data.forEach(r => console.log(JSON.stringify(r)));
      }
    }

    // Employee auth - check
    if (tables.find(t => Object.values(t)[0] === 'employee_auth')) {
      const [ea] = await conn.execute("SELECT employee_id, auth_type, is_active FROM employee_auth LIMIT 10");
      console.log('\nemployee_auth:');
      ea.forEach(r => console.log(JSON.stringify(r)));
    }

    await conn.end();
  } catch(e) { console.error('Error:', e.message); }
})();
