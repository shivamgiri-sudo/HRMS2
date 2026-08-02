const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: '192.168.10.6', port: 3306, user: 'shivam_user',
      password: 'qwersdfg!@#hjk', database: 'mas_hrms', connectTimeout: 5000
    });

    // Leave types
    const [ltypes] = await conn.execute("SELECT id, leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave, active_status FROM leave_type_master WHERE active_status=1");
    console.log('=== LEAVE TYPES ===');
    console.log('code|name|max_days|paid|requires_approval|carry_fwd');
    ltypes.forEach(r => console.log(r.leave_code+'|'+r.leave_name+'|'+r.max_days_per_year+'|'+r.paid_leave+'|'+r.requires_approval+'|'+r.carry_forward));

    // Leave balances for a real employee
    const [bal] = await conn.execute(
      "SELECT e.employee_code, lt.leave_code, lt.leave_name, lb.balance_days FROM leave_balance lb JOIN employees e ON e.id=lb.employee_id JOIN leave_type_master lt ON lt.id=lb.leave_type_id WHERE e.employee_code='MAS00175'"
    );
    console.log('\n=== LEAVE BALANCE - MAS00175 (NARESH) ===');
    bal.forEach(r => console.log(r.leave_code+'|'+r.leave_name+'|'+r.balance_days));

    // Attendance records for this employee
    const [att] = await conn.execute(
      "SELECT adr.record_date, adr.clock_in_time, adr.clock_out_time, adr.attendance_status, adr.source_system FROM attendance_daily_record adr JOIN employees e ON e.id=adr.employee_id WHERE e.employee_code='MAS00175' AND adr.record_date >= CURDATE()-INTERVAL 30 DAY ORDER BY adr.record_date DESC LIMIT 15"
    );
    console.log('\n=== ATTENDANCE - MAS00175 (Last 30 days) ===');
    console.log('date|clock_in|clock_out|status|source');
    att.forEach(r => console.log(r.record_date+'|'+r.clock_in_time+'|'+r.clock_out_time+'|'+r.attendance_status+'|'+r.source_system));

    // User roles for MAS00175
    const [roles] = await conn.execute(
      "SELECT ur.role_key FROM user_roles ur JOIN employees e ON e.id=ur.employee_id WHERE e.employee_code='MAS00175'"
    );
    console.log('\n=== ROLES - MAS00175 ===');
    roles.forEach(r => console.log(r.role_key));

    // Check auth table for password
    const [auth] = await conn.execute(
      "SELECT id, email, password_hash FROM auth_users WHERE email = 'NARESH.CHAUHAN@TEAMMAS.IN' LIMIT 1"
    );
    console.log('\n=== AUTH - NARESH ===');
    if (auth.length > 0) console.log('Has auth record: yes');
    else {
      // Check auth_employee or similar
      const [tables] = await conn.execute("SHOW TABLES LIKE '%auth%'");
      console.log('Auth tables:', tables.map(t => Object.values(t)[0]));
    }

    await conn.end();
  } catch(e) { console.error('Error:', e.message); }
})();
