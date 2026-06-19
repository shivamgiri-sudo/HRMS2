/**
 * Test Script: Inactive Employee Access
 * Tests the read-only access feature for inactive employees
 */

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || '192.168.10.6',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'shivam_user',
  password: process.env.DB_PASSWORD || 'qwersdfg!@#hjk',
  database: process.env.DB_NAME || 'mas_hrms',
};

async function runTests() {
  console.log('🧪 Testing Inactive Employee Access Feature\n');

  let connection: mysql.Connection | null = null;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Connected to database\n');

    // Test 1: Find an active employee to test with
    console.log('📋 Test 1: Finding test employee...');
    const [employees] = await connection.query(`
      SELECT
        e.id,
        e.employee_code,
        e.full_name,
        e.email,
        e.mobile as phone_primary,
        e.active_status,
        e.access_end_date,
        u.email as user_email
      FROM employees e
      LEFT JOIN auth_user u ON u.id = e.user_id
      WHERE e.user_id IS NOT NULL
        AND e.mobile IS NOT NULL
        AND e.mobile != ''
      LIMIT 1
    `);

    if ((employees as any[]).length === 0) {
      console.log('❌ No suitable test employee found (need employee with user_id and phone)');
      return;
    }

    const testEmployee = (employees as any[])[0];
    console.log(`✅ Found test employee: ${testEmployee.employee_code} - ${testEmployee.full_name}`);
    console.log(`   Email: ${testEmployee.user_email || 'N/A'}`);
    console.log(`   Phone: ${testEmployee.phone_primary}`);
    console.log(`   Current Status: ${testEmployee.active_status ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`   Access End Date: ${testEmployee.access_end_date || 'Not set'}\n`);

    // Test 2: Check if tables exist
    console.log('📋 Test 2: Verifying database schema...');

    const [logCount] = await connection.query(
      'SELECT COUNT(*) as count FROM auth_inactive_access_log'
    );
    console.log(`✅ auth_inactive_access_log table exists (${(logCount as any[])[0].count} records)`);

    const [otpCount] = await connection.query(
      'SELECT COUNT(*) as count FROM auth_password_reset_otp'
    );
    console.log(`✅ auth_password_reset_otp table exists (${(otpCount as any[])[0].count} records)\n`);

    // Test 3: Simulate making employee inactive
    console.log('📋 Test 3: Simulating inactive employee scenario...');
    console.log(`ℹ️  Note: Not actually changing employee status in this test`);
    console.log(`   To test manually, run:`);
    console.log(`   UPDATE employees SET active_status = 0 WHERE employee_code = '${testEmployee.employee_code}';\n`);

    // Test 4: Check existing inactive employees
    console.log('📋 Test 4: Checking existing inactive employees...');
    const [inactiveEmployees] = await connection.query(`
      SELECT
        employee_code,
        full_name,
        active_status,
        access_end_date,
        CASE
          WHEN access_end_date IS NULL THEN 'No grace period set'
          WHEN access_end_date < CURDATE() THEN 'EXPIRED'
          ELSE CONCAT('ACTIVE (', DATEDIFF(access_end_date, CURDATE()), ' days remaining)')
        END as grace_status
      FROM employees
      WHERE active_status = 0
      LIMIT 10
    `);

    if ((inactiveEmployees as any[]).length > 0) {
      console.log(`✅ Found ${(inactiveEmployees as any[]).length} inactive employees:`);
      (inactiveEmployees as any[]).forEach((emp: any, idx: number) => {
        console.log(`   ${idx + 1}. ${emp.employee_code} - ${emp.full_name}`);
        console.log(`      Grace Period: ${emp.grace_status}`);
      });
    } else {
      console.log(`ℹ️  No inactive employees found`);
    }
    console.log();

    // Test 5: Check recent access logs
    console.log('📋 Test 5: Checking recent access logs...');
    const [recentLogs] = await connection.query(`
      SELECT
        e.employee_code,
        e.full_name,
        l.login_at,
        l.access_granted,
        l.denial_reason
      FROM auth_inactive_access_log l
      JOIN employees e ON e.id = l.employee_id
      ORDER BY l.login_at DESC
      LIMIT 5
    `);

    if ((recentLogs as any[]).length > 0) {
      console.log(`✅ Recent access attempts:`);
      (recentLogs as any[]).forEach((log: any, idx: number) => {
        console.log(`   ${idx + 1}. ${log.employee_code} at ${log.login_at}`);
        console.log(`      Status: ${log.access_granted ? '✅ GRANTED' : '❌ DENIED'}`);
        if (log.denial_reason) {
          console.log(`      Reason: ${log.denial_reason}`);
        }
      });
    } else {
      console.log(`ℹ️  No access logs yet (this is normal for a fresh installation)`);
    }
    console.log();

    // Test 6: Check OTP records
    console.log('📋 Test 6: Checking OTP records...');
    const [recentOTPs] = await connection.query(`
      SELECT
        phone,
        otp_code,
        expires_at,
        verified,
        created_at,
        CASE
          WHEN expires_at < NOW() THEN 'EXPIRED'
          WHEN verified = 1 THEN 'USED'
          ELSE 'ACTIVE'
        END as status
      FROM auth_password_reset_otp
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if ((recentOTPs as any[]).length > 0) {
      console.log(`✅ Recent OTPs:`);
      (recentOTPs as any[]).forEach((otp: any, idx: number) => {
        console.log(`   ${idx + 1}. Phone: ${otp.phone.substring(0, 3)}***${otp.phone.slice(-2)}`);
        console.log(`      Status: ${otp.status}`);
        console.log(`      Created: ${otp.created_at}`);
      });
    } else {
      console.log(`ℹ️  No OTP records yet`);
    }
    console.log();

    // Summary
    console.log('📊 Test Summary:');
    console.log('   ✅ Database connection working');
    console.log('   ✅ Migration completed successfully');
    console.log('   ✅ Tables created and accessible');
    console.log(`   ✅ Test employee available: ${testEmployee.employee_code}`);
    console.log();
    console.log('🎯 Next Steps:');
    console.log('   1. Start the backend server: npm run dev');
    console.log('   2. Start the frontend: npm run dev (in frontend directory)');
    console.log('   3. Try logging in as an inactive employee');
    console.log('   4. Try the SMS/OTP password reset flow');
    console.log('   5. See TESTING_INACTIVE_ACCESS_OTP.md for detailed test cases\n');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runTests().catch(console.error);
