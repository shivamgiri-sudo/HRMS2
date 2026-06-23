import { db } from './src/db/mysql.js';

async function testManagerSetup() {
  console.log('=== STEP 1: MANAGER ACCOUNT SETUP ===\n');

  // Find manager users
  const [managers] = await db.execute<any[]>(`
    SELECT e.id, e.employee_code, e.first_name, e.email, au.id AS user_id, ur.role_key
    FROM employees e
    JOIN auth_user au ON au.id = e.user_id
    LEFT JOIN user_roles ur ON ur.user_id = au.id
    WHERE e.active_status = 1
      AND (ur.role_key = 'manager' OR e.id IN (
        SELECT DISTINCT reporting_manager_id FROM employees WHERE reporting_manager_id IS NOT NULL
      ))
    LIMIT 5
  `);

  console.log('Manager users found:', managers.length);
  managers.forEach((m: any) => {
    console.log(`  - ${m.employee_code}: ${m.first_name} (${m.email}), role: ${m.role_key || 'NO_ROLE'}`);
  });

  if (managers.length > 0) {
    const manager = managers[0];
    console.log(`\nSelected manager: ${manager.employee_code} - ${manager.first_name}`);

    // Get team size
    const [teamSize] = await db.execute<any[]>(`
      SELECT COUNT(*) AS team_size
      FROM employees
      WHERE reporting_manager_id = ?
        AND active_status = 1
    `, [manager.id]);

    console.log(`Team size: ${teamSize[0].team_size} employees`);

    // Get sample team members
    const [teamMembers] = await db.execute<any[]>(`
      SELECT employee_code, first_name, last_name, email
      FROM employees
      WHERE reporting_manager_id = ?
        AND active_status = 1
      LIMIT 5
    `, [manager.id]);

    console.log('\nSample team members:');
    teamMembers.forEach((t: any) => {
      console.log(`  - ${t.employee_code}: ${t.first_name} ${t.last_name}`);
    });

    // Check if manager has password set
    const [authCheck] = await db.execute<any[]>(`
      SELECT id, email, password_hash IS NOT NULL AS has_password
      FROM auth_user
      WHERE id = ?
    `, [manager.user_id]);

    console.log('\nAuth status:');
    console.log(`  Email: ${authCheck[0].email}`);
    console.log(`  Has password: ${authCheck[0].has_password ? 'YES' : 'NO'}`);

    if (!authCheck[0].has_password) {
      console.log('\n  WARNING: Manager has no password set! Cannot test frontend login.');
    }
  } else {
    console.log('\nWARNING: No manager users found in database!');
  }

  await db.end();
}

testManagerSetup().catch(console.error);
