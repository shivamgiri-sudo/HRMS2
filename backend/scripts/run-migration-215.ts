/**
 * Migration Runner: 215_inactive_access_and_otp_auth.sql
 * Run with: npx tsx backend/scripts/run-migration-215.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Database configuration from environment
const DB_CONFIG = {
  host: requiredEnv('DB_HOST'),
  port: parseInt(process.env.DB_PORT || '3306'),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
  multipleStatements: true, // Required for running multiple SQL statements
};

async function runMigration() {
  console.log('🚀 Starting Migration 215: Inactive Access & OTP Auth\n');
  console.log(`📊 Database: ${DB_CONFIG.database}@${DB_CONFIG.host}:${DB_CONFIG.port}`);
  console.log(`👤 User: ${DB_CONFIG.user}\n`);

  let connection: mysql.Connection | null = null;

  try {
    // Connect to database
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Connected successfully\n');

    // Read migration file (no-trigger version for permission constraints)
    const migrationPath = join(__dirname, '..', 'sql', '215_inactive_access_and_otp_auth_no_trigger.sql');
    console.log(`📄 Reading migration file: ${migrationPath}`);
    const sql = readFileSync(migrationPath, 'utf-8');
    console.log(`✅ Migration file loaded (${sql.length} characters)\n`);
    console.log('ℹ️  Note: Trigger skipped due to SUPER privilege requirement');
    console.log('   Grace period will be set by application code instead\n');

    // Execute migration
    console.log('⚙️  Executing migration...\n');
    const statements = sql
      .split('DELIMITER')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement || statement === '$$' || statement === ';') continue;

      console.log(`   [${i + 1}/${statements.length}] Executing statement...`);

      try {
        await connection.query(statement.replace(/\$\$/g, ''));
        console.log(`   ✅ Success`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
        if (code === 'ER_DUP_FIELDNAME' || message.includes('Duplicate column')) {
          console.log(`   ⚠️  Column already exists, skipping`);
        } else if (code === 'ER_TABLE_EXISTS_ERROR' || message.includes('already exists')) {
          console.log(`   ⚠️  Table already exists, skipping`);
        } else if (message.includes('Trigger already exists')) {
          console.log(`   ⚠️  Trigger already exists, skipping`);
        } else {
          throw error;
        }
      }
    }

    console.log('\n✅ Migration completed successfully!\n');

    // Verify migration
    console.log('🔍 Verifying migration...\n');

    // Check access_end_date column
    const [columns] = await connection.query(
      "SHOW COLUMNS FROM employees LIKE 'access_end_date'"
    );
    console.log(`   ${(columns as Array<Record<string, unknown>>).length > 0 ? '✅' : '❌'} employees.access_end_date column`);

    // Check auth_inactive_access_log table
    const [logTable] = await connection.query(
      "SHOW TABLES LIKE 'auth_inactive_access_log'"
    );
    console.log(`   ${(logTable as Array<Record<string, unknown>>).length > 0 ? '✅' : '❌'} auth_inactive_access_log table`);

    // Check auth_password_reset_otp table
    const [otpTable] = await connection.query(
      "SHOW TABLES LIKE 'auth_password_reset_otp'"
    );
    console.log(`   ${(otpTable as Array<Record<string, unknown>>).length > 0 ? '✅' : '❌'} auth_password_reset_otp table`);

    // Check trigger (optional - not required for this version)
    const [triggers] = await connection.query(
      "SHOW TRIGGERS WHERE `Trigger` = 'set_access_end_date_on_inactive'"
    );
    console.log(`   ${(triggers as Array<Record<string, unknown>>).length > 0 ? '✅' : 'ℹ️ '} set_access_end_date_on_inactive trigger ${(triggers as Array<Record<string, unknown>>).length === 0 ? '(skipped - not required)' : ''}`);

    // Check index
    const [indexes] = await connection.query(
      "SHOW INDEX FROM employees WHERE Key_name = 'idx_employees_status_access'"
    );
    console.log(`   ${(indexes as Array<Record<string, unknown>>).length > 0 ? '✅' : '❌'} idx_employees_status_access index`);

    console.log('\n🎉 Migration verification complete!\n');
    console.log('📝 Next steps:');
    console.log('   1. Test inactive employee login');
    console.log('   2. Test SMS/OTP password reset');
    console.log('   3. See TESTING_INACTIVE_ACCESS_OTP.md for detailed tests\n');

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Migration failed!\n');
    console.error('Error:', message);
    if (error && typeof error === 'object' && 'sql' in error) {
      const sqlText = String((error as { sql?: unknown }).sql ?? '');
      console.error('SQL:', sqlText.substring(0, 200) + '...');
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed\n');
    }
  }
}

// Run migration
runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
