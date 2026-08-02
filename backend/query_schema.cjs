const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: '192.168.10.6', port: 3306, user: 'shivam_user',
      password: 'qwersdfg!@#hjk', database: 'mas_hrms', connectTimeout: 5000
    });

    // Find leave-related tables
    const [tables] = await conn.execute("SHOW TABLES LIKE '%leave%'");
    console.log('=== LEAVE TABLES ===');
    tables.forEach(t => {
      const name = Object.values(t)[0];
      console.log('- '+name);
    });

    // Find balance table
    const [balTables] = await conn.execute("SHOW TABLES LIKE '%balance%'");
    console.log('\n=== BALANCE TABLES ===');
    balTables.forEach(t => {
      const name = Object.values(t)[0];
      console.log('- '+name);
    });

    // Check attendance tables
    const [attTables] = await conn.execute("SHOW TABLES LIKE '%attendance%'");
    console.log('\n=== ATTENDANCE TABLES ===');
    attTables.forEach(t => {
      const name = Object.values(t)[0];
      console.log('- '+name);
    });

    // Check regularization tables
    const [regTables] = await conn.execute("SHOW TABLES LIKE '%regular%'");
    console.log('\n=== REGULARIZATION TABLES ===');
    regTables.forEach(t => {
      const name = Object.values(t)[0];
      console.log('- '+name);
    });

    // Check user_roles table for people with leave/WFM roles
    const [roles] = await conn.execute(
      "SELECT e.employee_code, e.email, ur.role_key FROM user_roles ur JOIN employees e ON e.id=ur.employee_id WHERE e.email NOT IN ('','NA','N/A','na') AND ur.role_key IN ('hr_admin','hr','super_admin','wfm','admin','process_manager','operations_manager') LIMIT 20"
    );
    console.log('\n=== USERS WITH ADMIN/WFM ROLES ===');
    roles.forEach(r => console.log(r.employee_code+'|'+r.email+'|'+r.role_key));

    await conn.end();
  } catch(e) { console.error('Error:', e.message); }
})();
