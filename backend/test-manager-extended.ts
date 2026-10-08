import { db } from './src/db/mysql.js';

async function testManagerData() {
  console.log('=== ANALYZING MANAGER DATA ===\n');

  // Find all employees who ARE managers (have people reporting to them)
  const [managersWithTeams] = await db.execute<any[]>(`
    SELECT
      m.id,
      m.employee_code,
      m.first_name,
      m.last_name,
      m.email,
      COUNT(e.id) AS team_size
    FROM employees m
    JOIN employees e ON e.reporting_manager_id = m.id
    WHERE m.active_status = 1
      AND e.active_status = 1
    GROUP BY m.id, m.employee_code, m.first_name, m.last_name, m.email
    ORDER BY team_size DESC
    LIMIT 10
  `);

  console.log('Managers with teams:');
  if (managersWithTeams.length === 0) {
    console.log('  NO MANAGERS WITH TEAMS FOUND!');
  } else {
    managersWithTeams.forEach((m: any) => {
      console.log(`  - ${m.employee_code}: ${m.first_name} ${m.last_name} (${m.team_size} team members)`);
    });
  }

  // Check total employees
  const [totalEmployees] = await db.execute<any[]>(`
    SELECT COUNT(*) AS total FROM employees WHERE active_status = 1
  `);
  console.log(`\nTotal active employees: ${totalEmployees[0].total}`);

  // Check reporting structure
  const [reportingStats] = await db.execute<any[]>(`
    SELECT
      COUNT(CASE WHEN reporting_manager_id IS NOT NULL THEN 1 END) AS has_manager,
      COUNT(CASE WHEN reporting_manager_id IS NULL THEN 1 END) AS no_manager
    FROM employees
    WHERE active_status = 1
  `);
  console.log(`\nReporting structure:`);
  console.log(`  - Employees with manager: ${reportingStats[0].has_manager}`);
  console.log(`  - Employees without manager: ${reportingStats[0].no_manager}`);

  // Check role assignments
  const [roleStats] = await db.execute<any[]>(`
    SELECT
      ur.role_key,
      COUNT(*) AS count
    FROM user_roles ur
    JOIN auth_user au ON au.id = ur.user_id
    JOIN employees e ON e.user_id = au.id
    WHERE e.active_status = 1
    GROUP BY ur.role_key
    ORDER BY count DESC
  `);
  console.log(`\nRole distribution:`);
  roleStats.forEach((r: any) => {
    console.log(`  - ${r.role_key}: ${r.count} employees`);
  });

  // Get the test manager's details
  const [testManager] = await db.execute<any[]>(`
    SELECT
      e.id,
      e.employee_code,
      e.first_name,
      e.email,
      au.id AS user_id,
      ur.role_key
    FROM employees e
    JOIN auth_user au ON au.id = e.user_id
    LEFT JOIN user_roles ur ON ur.user_id = au.id
    WHERE e.employee_code = 'EMP-MGR-001'
  `);

  if (testManager.length > 0) {
    console.log(`\n=== TEST MANAGER DETAILS ===`);
    console.log(`Employee ID: ${testManager[0].id}`);
    console.log(`Code: ${testManager[0].employee_code}`);
    console.log(`Name: ${testManager[0].first_name}`);
    console.log(`Email: ${testManager[0].email}`);
    console.log(`User ID: ${testManager[0].user_id}`);
    console.log(`Role: ${testManager[0].role_key || 'NONE'}`);

    // Assign some employees to this manager if none exist
    if (managersWithTeams.length === 0 ||
        !managersWithTeams.some((m: any) => m.id === testManager[0].id)) {
      console.log(`\nManager has no team. Checking employees available for assignment...`);

      const [availableEmployees] = await db.execute<any[]>(`
        SELECT id, employee_code, first_name, last_name
        FROM employees
        WHERE active_status = 1
          AND id != ?
          AND reporting_manager_id IS NULL
        LIMIT 5
      `, [testManager[0].id]);

      console.log(`\nAvailable employees without manager: ${availableEmployees.length}`);
      availableEmployees.forEach((emp: any) => {
        console.log(`  - ${emp.employee_code}: ${emp.first_name} ${emp.last_name}`);
      });

      if (availableEmployees.length > 0) {
        console.log(`\nWOULD assign these ${availableEmployees.length} employees to manager (READ-ONLY TEST - not executing)`);
      }
    }
  }

  await db.end();
}

testManagerData().catch(console.error);
