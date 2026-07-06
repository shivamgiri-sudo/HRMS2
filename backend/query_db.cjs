const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: '192.168.10.6', port: 3306, user: 'shivam_user',
      password: 'qwersdfg!@#hjk', database: 'mas_hrms', connectTimeout: 5000
    });

    // Employees with valid emails
    const [emps] = await conn.execute(
      "SELECT id,employee_code,email,CONCAT(first_name,' ',COALESCE(last_name,'')) AS name FROM employees WHERE active_status=1 AND email IS NOT NULL AND email NOT IN ('','NA','N/A','na') LIMIT 25"
    );
    console.log('=== ACTIVE EMPLOYEES WITH EMAIL ===');
    emps.forEach(r => console.log(r.employee_code+'|'+r.email+'|'+r.name));

    // Leave type columns
    const [cols] = await conn.execute('SHOW COLUMNS FROM leave_type_master');
    console.log('\n=== LEAVE TYPE MASTER COLUMNS ===');
    cols.forEach(c => console.log(c.Field+' ('+c.Type+')'));

    // Leave types
    const [ltypes] = await conn.execute("SELECT * FROM leave_type_master WHERE status=1 OR is_active=1 LIMIT 10");
    console.log('\n=== LEAVE TYPES ===');
    if (ltypes.length > 0) {
      const keys = Object.keys(ltypes[0]);
      console.log(keys.join('|'));
      ltypes.forEach(r => console.log(keys.map(k => r[k]).join('|')));
    } else {
      const [all] = await conn.execute("SELECT * FROM leave_type_master LIMIT 5");
      console.log('All records columns:', Object.keys(all[0] || {}));
      all.forEach(r => console.log(JSON.stringify(r)));
    }

    // Check user_roles table
    const [roles] = await conn.execute("SELECT employee_id, role_key FROM user_roles WHERE employee_id IN (SELECT id FROM employees WHERE active_status=1 AND email NOT IN ('','NA','N/A','na') LIMIT 10)");
    console.log('\n=== USER ROLES ===');
    roles.forEach(r => console.log(r.employee_id+'|'+r.role_key));

    // Employee IDs from our query
    const empIds = emps.map(e => e.id).slice(0, 5);

    // Leave balances
    console.log('\n=== LEAVE BALANCES ===');
    for (const eid of empIds) {
      const empCode = emps.find(e => e.id === eid).employee_code;
      const [bal] = await conn.execute(
        "SELECT * FROM leave_balance WHERE employee_id = ? LIMIT 5", [eid]
      );
      if (bal.length > 0) {
        console.log('Employee '+empCode+':');
        bal.forEach(r => console.log('  '+JSON.stringify(r)));
      }
    }

    // Recent attendance
    const [att] = await conn.execute(
      "SELECT employee_id, record_date, clock_in_time, clock_out_time, attendance_status, source_system FROM attendance_daily_record WHERE record_date >= CURDATE() - INTERVAL 7 DAY ORDER BY record_date DESC LIMIT 10"
    );
    console.log('\n=== RECENT ATTENDANCE (7 days) ===');
    att.forEach(r => console.log(r.employee_id+'|'+r.record_date+'|'+r.clock_in_time+'|'+r.clock_out_time+'|'+r.attendance_status+'|'+r.source_system));

    // Regularization requests
    const [reg] = await conn.execute(
      "SELECT id, employee_id, attendance_date, status, request_type, created_at FROM attendance_regularization ORDER BY created_at DESC LIMIT 5"
    );
    console.log('\n=== REGULARIZATION REQUESTS ===');
    if (reg.length > 0) reg.forEach(r => console.log(JSON.stringify(r)));
    else console.log('None found');

    await conn.end();
  } catch(e) { console.error('Error:', e.message); }
})();
