import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '192.168.10.6',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms',
  waitForConnections: true,
  connectionLimit: 5,
});

async function checkPageAccess() {
  try {
    console.log('\n=== Checking super_admin Page Access ===\n');

    // 1. Check role_page_access entries for super_admin
    const [superAdminPages] = await pool.execute(`
      SELECT COUNT(*) as count
      FROM role_page_access
      WHERE role_key = 'super_admin' AND active_status = 1
    `);

    const superAdminCount = superAdminPages[0].count;
    console.log(`📄 role_page_access entries for super_admin: ${superAdminCount}`);

    if (superAdminCount === 0) {
      console.log('');
      console.log('❌ PROBLEM FOUND: super_admin has ZERO page access entries!');
      console.log('');
      console.log('This is why pages are hidden. super_admin should have ALL pages.');
      console.log('');

      // Check total pages in catalog
      const [catalogCount] = await pool.execute(`
        SELECT COUNT(*) as count FROM page_catalog WHERE active_status = 1
      `);
      console.log(`📋 Total pages in page_catalog: ${catalogCount[0].count}`);
      console.log('');

      // Check if admin role has pages
      const [adminPages] = await pool.execute(`
        SELECT COUNT(*) as count
        FROM role_page_access
        WHERE role_key = 'admin' AND active_status = 1
      `);
      console.log(`📄 role_page_access entries for admin: ${adminPages[0].count}`);
      console.log('');

      console.log('🔧 FIX OPTIONS:');
      console.log('');
      console.log('Option 1: Grant ALL pages to super_admin');
      console.log('   See grant-super-admin-all-pages.sql');
      console.log('');
      console.log('Option 2: Modify backend to bypass page check for super_admin');
      console.log('   File: backend/src/modules/access/access.service.ts');
      console.log('   Line 194: Add special case before querying role_page_access');
      console.log('');
      console.log('Option 3: Copy admin permissions to super_admin');
      console.log('   See copy-admin-to-super-admin.sql');

    } else {
      console.log(`✅ super_admin has ${superAdminCount} page access entries`);
      console.log('');

      // Show sample pages
      const [samplePages] = await pool.execute(`
        SELECT rpa.page_code, rpa.can_view, rpa.can_create, rpa.can_edit, rpa.can_delete, rpa.can_export,
               pc.page_name, pc.module
        FROM role_page_access rpa
        LEFT JOIN page_catalog pc ON pc.page_code = rpa.page_code
        WHERE rpa.role_key = 'super_admin' AND rpa.active_status = 1
        LIMIT 10
      `);

      console.log('Sample pages accessible to super_admin:');
      samplePages.forEach((p) => {
        const perms = [];
        if (p.can_view) perms.push('view');
        if (p.can_create) perms.push('create');
        if (p.can_edit) perms.push('edit');
        if (p.can_delete) perms.push('delete');
        if (p.can_export) perms.push('export');
        console.log(`   - ${p.page_code} (${p.page_name || 'N/A'}): ${perms.join(', ')}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkPageAccess();
