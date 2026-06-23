#!/usr/bin/env tsx
/**
 * Bulk Create Auth Accounts for All Active Employees
 *
 * Creates auth_user records for all active employees who have email addresses
 * but don't have auth accounts yet. Sets a random unknown temporary password and
 * forces password change on first login.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../src/db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

interface Employee {
  id: string;
  employee_code: string;
  email: string;
  first_name: string;
  last_name: string | null;
}

async function createAuthAccount(employee: Employee): Promise<boolean> {
  try {
    // Check if auth account already exists for this email
    const [existing] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM auth_user WHERE email = ? LIMIT 1',
      [employee.email.toLowerCase().trim()]
    );

    if (existing.length > 0) {
      console.log(`⚠️  Account already exists for ${employee.email}`);
      return false;
    }

    // Generate user ID and hash a random unknown password. The user must use
    // the invite/reset flow; no raw password is printed or stored outside hash.
    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    // Create auth_user record
    await db.execute<ResultSetHeader>(
      `INSERT INTO auth_user (
        id,
        email,
        password_hash,
        must_change_password,
        password_changed_at,
        created_at
      ) VALUES (?, ?, ?, 1, NOW(), NOW())`,
      [userId, employee.email.toLowerCase().trim(), passwordHash]
    );

    // Link employee to auth_user
    await db.execute(
      'UPDATE employees SET user_id = ? WHERE id = ?',
      [userId, employee.id]
    );

    // Assign default 'employee' role
    await db.execute(
      `INSERT INTO user_roles (id, user_id, role_key, active_status)
       VALUES (UUID(), ?, 'employee', 1)
       ON DUPLICATE KEY UPDATE active_status = 1`,
      [userId]
    );

    console.log(`✅ Created account for ${employee.first_name} ${employee.last_name || ''} (${employee.employee_code}) - ${employee.email}`);
    return true;

  } catch (error: any) {
    console.error(`❌ Failed to create account for ${employee.email}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('\n🔐 Bulk Auth Account Creation Script\n');
  console.log('━'.repeat(80));

  try {
    // Fetch all active employees without auth accounts
    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT
        e.id,
        e.employee_code,
        e.email,
        e.first_name,
        e.last_name
      FROM employees e
      WHERE e.user_id IS NULL
        AND (e.employment_status = 'Active' OR e.employment_status = 'active')
        AND e.email IS NOT NULL
        AND e.email != ''
      ORDER BY e.employee_code ASC`
    );

    console.log(`\n📊 Found ${employees.length} active employees without auth accounts\n`);

    if (employees.length === 0) {
      console.log('✅ All active employees already have auth accounts!');
      process.exit(0);
    }

    console.log('🚀 Starting bulk account creation...\n');

    let created = 0;
    let failed = 0;
    let skipped = 0;

    for (const emp of employees as Employee[]) {
      const result = await createAuthAccount(emp);
      if (result === true) {
        created++;
      } else if (result === false) {
        skipped++;
      } else {
        failed++;
      }

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log('\n' + '━'.repeat(80));
    console.log('\n📈 Summary:');
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ⚠️  Skipped: ${skipped}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📊 Total: ${employees.length}`);

    console.log('\n🔑 New accounts use random unknown password hashes.');
    console.log('   ⚠️  Users must use the invite/reset flow and will be forced to change on first login');

    console.log('\n✅ Bulk account creation complete!\n');

  } catch (error: any) {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
