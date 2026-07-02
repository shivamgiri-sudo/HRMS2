import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '192.168.10.6',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms',
  waitForConnections: true,
  connectionLimit: 5,
});

async function checkSuperAdmin() {
  try {
    console.log('\n=== Checking shivam.giri@teammas.in Access ===\n');

    // 1. Get user and roles
    const [userRows] = await pool.execute(`
      SELECT
        u.id, u.email, u.is_blocked,
        GROUP_CONCAT(DISTINCT ur.role_key) as role_keys,
        MAX(e.id) as employee_id, MAX(e.employee_code) as employee_code, MAX(e.active_status) as active_status,
        MAX(e.first_name) as first_name, MAX(e.last_name) as last_name
      FROM auth_user u
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND ur.active_status = 1
      LEFT JOIN employees e ON u.id = e.user_id
      WHERE u.email = 'shivam.giri@teammas.in'
      GROUP BY u.id, u.email, u.is_blocked
    `);

    if (userRows.length === 0) {
      console.log('❌ User not found!');
      return;
    }

    const user = userRows[0];
    console.log('📧 Email:', user.email);
    console.log('👤 Name:', `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'N/A');
    console.log('🆔 User ID:', user.id);
    console.log('🔒 Blocked:', user.is_blocked === 1 ? 'YES ❌' : 'NO ✅');
    console.log('👔 Employee ID:', user.employee_id || 'N/A');
    console.log('🏷️  Employee Code:', user.employee_code || 'N/A');
    console.log('📊 Active Status:', user.active_status === 1 ? 'Active ✅' : user.active_status === 0 ? 'Inactive ❌' : 'N/A');
    console.log('🎭 Roles:', user.role_keys || 'NONE ❌');
    console.log('');

    // 2. Check if super_admin role exists
    const [roleCheck] = await pool.execute(`
      SELECT id, role_key, role_name, active_status
      FROM workforce_role_catalog
      WHERE role_key = 'super_admin'
    `);

    if (roleCheck.length === 0) {
      console.log('❌ super_admin role does NOT exist in workforce_role_catalog!');
      console.log('');
      console.log('📝 Available roles:');
      const [allRoles] = await pool.execute(`
        SELECT role_key, role_name, active_status
        FROM workforce_role_catalog
        WHERE active_status = 1
        ORDER BY role_name
      `);
      allRoles.forEach(r => console.log(`   - ${r.role_key} (${r.role_name})`));
    } else {
      console.log('✅ super_admin role exists in catalog:', roleCheck[0]);
    }

    console.log('');

    // 3. Check user_roles assignment
    const [userRoleRows] = await pool.execute(`
      SELECT ur.role_key, ur.active_status, wrc.role_name
      FROM user_roles ur
      LEFT JOIN workforce_role_catalog wrc ON ur.role_key = wrc.role_key
      WHERE ur.user_id = ?
    `, [user.id]);

    console.log('📋 User role assignments:');
    if (userRoleRows.length === 0) {
      console.log('   ❌ NO ROLES ASSIGNED!');
      console.log('');
      console.log('🔧 FIX: Run this SQL:');
      console.log(`   INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (UUID(), '${user.id}', 'super_admin', 1);`);
    } else {
      userRoleRows.forEach(r => {
        const status = r.active_status === 1 ? '✅ Active' : '❌ Inactive';
        console.log(`   - ${r.role_key} (${r.role_name || 'Unknown'}) ${status}`);
      });
    }

    console.log('');
    console.log('===========================================');
    console.log('');

    // Summary
    const hasSuperAdmin = user.role_keys && user.role_keys.includes('super_admin');
    const isBlocked = user.is_blocked === 1;
    const isActive = user.active_status === 1;

    if (isBlocked) {
      console.log('❌ PROBLEM: User is BLOCKED');
    } else if (!hasSuperAdmin) {
      console.log('❌ PROBLEM: User does NOT have super_admin role');
      console.log('');
      console.log('🔧 FIX: Run this SQL to grant super_admin:');
      console.log(`   INSERT INTO user_roles (id, user_id, role_key, active_status)`);
      console.log(`   VALUES (UUID(), '${user.id}', 'super_admin', 1)`);
      console.log(`   ON DUPLICATE KEY UPDATE active_status = 1;`);
    } else if (!isActive && user.employee_id) {
      console.log('⚠️  WARNING: Employee record is INACTIVE (this may block some pages)');
    } else {
      console.log('✅ User has super_admin role and should see ALL pages!');
      console.log('');
      console.log('If pages are still hidden, check:');
      console.log('   1. Browser console for errors');
      console.log('   2. Frontend auth context (useWorkforceAccess hook)');
      console.log('   3. JWT token content (localStorage "access_token")');
      console.log('   4. Backend /api/auth/me response');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSuperAdmin();
