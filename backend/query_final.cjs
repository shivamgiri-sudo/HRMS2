const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: '192.168.10.6', port: 3306, user: 'shivam_user',
      password: 'qwersdfg!@#hjk', database: 'mas_hrms', connectTimeout: 5000
    });

    // User roles columns
    const [urCols] = await conn.execute('SHOW COLUMNS FROM user_roles');
    console.log('=== USER_ROLES COLUMNS ===');
    urCols.forEach(c => console.log(c.Field+' ('+c.Type+')'));

    // Roles
    const [roles] = await conn.execute(
      "SELECT DISTINCT user_id, role_key FROM user_roles WHERE role_key IN ('hr_admin','hr','super_admin','wfm','admin','process_manager','operations_manager') LIMIT 20"
    );
    console.log('\n=== ROLES ===');
    const roleUserIds = [...new Set(roles.map(r => r.user_id))];    
    for (const uid of roleUserIds.slice(0,10)) {
      const [e] = await conn.execute("SELECT employee_code, email FROM employees WHERE id=? AND email NOT IN ('','NA','N/A','na') LIMIT 1", [uid]);
      if (e.length > 0) {
        const [r] = await conn.execute("SELECT role_key FROM user_roles WHERE user_id=?", [uid]);
        console.log(e[0].employee_code+'|'+e[0].email+'|'+r.map(x=>x.role_key).join(','));
      }
    }

    // Leave balance ledger columns
    const [lblCols] = await conn.execute('SHOW COLUMNS FROM leave_balance_ledger');
    console.log('\n=== LEAVE_BALANCE_LEDGER COLUMNS ===');
    lblCols.forEach(c => console.log(c.Field+' ('+c.Type+')'));

    // Leave balance for MAS00175
    const [eid] = await conn.execute("SELECT id FROM employees WHERE employee_code='MAS00175' LIMIT 1");
    if (eid.length > 0) {
      const [bal] = await conn.execute(
        "SELECT l.leave_code, l.leave_name, lb.balance_days FROM leave_balance_ledger lb JOIN leave_type_master l ON l.id=lb.leave_type_id WHERE lb.employee_id=? ORDER BY lb.created_at DESC LIMIT 10",
        [eid[0].id]
      );
      console.log('\n=== BALANCE - MAS00175 ===');
      bal.forEach(r => console.log(r.leave_code+'|'+r.leave_name+'|'+r.balance_days));
    }

    // Check auth_users table for password fields
    const [authCols] = await conn.execute('SHOW COLUMNS FROM employee_auth');
    console.log('\n=== EMPLOYEE_AUTH COLUMNS ===');
    authCols.forEach(c => console.log(c.Field+' ('+c.Type+')'));

    await conn.end();
  } catch(e) { console.error('Error:', e.message); }
})();
