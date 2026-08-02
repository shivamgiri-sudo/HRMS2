const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: '192.168.10.6', port: 3306, user: 'shivam_user',
      password: 'qwersdfg!@#hjk', database: 'mas_hrms', connectTimeout: 5000
    });
    // Get employees with email (potential login users)
    const [rows] = await conn.execute(
      "SELECT id, employee_code, email, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name FROM employees WHERE active_status=1 AND email IS NOT NULL AND email!='' LIMIT 30"
    );
    console.log('=== EMPLOYEES ===');
    console.log('id|employee_code|email|name');
    rows.forEach(r => console.log(r.id+'|'+r.employee_code+'|'+r.email+'|'+r.name));

    // Get leave types
    const [leaveTypes] = await conn.execute("SELECT id, leave_type_name, leave_code, default_days, is_active FROM leave_type_master WHERE is_active=1");
    console.log('\n=== LEAVE TYPES ===');
    console.log('id|leave_type_name|leave_code|default_days');
    leaveTypes.forEach(r => console.log(r.id+'|'+r.leave_type_name+'|'+r.leave_code+'|'+r.default_days));

    // Get leave balances for first few employees  
    const [empIds] = await conn.execute("SELECT id, employee_code FROM employees WHERE active_status=1 LIMIT 5");
    for (const emp of empIds) {
      const [bal] = await conn.execute(
        "SELECT lt.leave_type_name, lb.balance_days FROM leave_balance lb JOIN leave_type_master lt ON lt.id = lb.leave_type_id WHERE lb.employee_id = ? LIMIT 5",
        [emp.id]
      );
      if (bal.length > 0) {
        console.log('\n=== LEAVE BALANCE: '+emp.employee_code+' ===');
        bal.forEach(r => console.log(r.leave_type_name+'|'+r.balance_days));
      }
    }

    // Check attendance records
    const [att] = await conn.execute(
      "SELECT employee_id, record_date, clock_in_time, clock_out_time, attendance_status FROM attendance_daily_record WHERE record_date >= CURDATE() - INTERVAL 7 DAY ORDER BY record_date DESC LIMIT 10"
    );
    console.log('\n=== RECENT ATTENDANCE ===');
    console.log('employee_id|record_date|clock_in|clock_out|status');
    att.forEach(r => console.log(r.employee_id+'|'+r.record_date+'|'+r.clock_in_time+'|'+r.clock_out_time+'|'+r.attendance_status));

    await conn.end();
  } catch(e) { console.error('DB Error:', e.message); }
})();
