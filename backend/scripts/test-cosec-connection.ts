#!/usr/bin/env npx tsx
/**
 * test-cosec-connection.ts
 *
 * Quick test to verify COSEC database connectivity
 * Usage: npx tsx scripts/test-cosec-connection.ts
 */

import 'dotenv/config';
import sql from 'mssql';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; configure it in backend/.env or the Integration Hub`);
  return value;
}

const config: sql.config = {
  server: process.env.NCOSEC_DB_HOST || '<NCOSEC_DB_HOST>',
  port: parseInt(process.env.NCOSEC_DB_PORT || '1433', 10),
  user: requiredEnv('NCOSEC_DB_USER'),
  password: requiredEnv('NCOSEC_DB_PASSWORD'),
  database: process.env.NCOSEC_DB_NAME || 'NCOSEC',
  options: {
    encrypt: process.env.NCOSEC_DB_ENCRYPT === 'true',
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

async function testConnection() {
  console.log('┌────────────────────────────────────────────┐');
  console.log('│  COSEC Database Connection Test            │');
  console.log('└────────────────────────────────────────────┘\n');

  console.log('Configuration:');
  console.log(`  Host:     ${config.server}`);
  console.log(`  Port:     ${config.port}`);
  console.log(`  User:     ${config.user}`);
  console.log(`  Password: ${'*'.repeat(config.password?.length || 0)}`);
  console.log(`  Database: ${config.database}`);
  console.log(`  Encrypt:  ${config.options?.encrypt}\n`);

  let pool: sql.ConnectionPool | null = null;

  try {
    console.log('[1/4] Connecting to COSEC SQL Server...');
    pool = await new sql.ConnectionPool(config).connect();
    console.log('✓ Connected successfully!\n');

    // Test 1: Basic query
    console.log('[2/4] Testing basic query...');
    const testResult = await pool.request().query('SELECT 1 AS test');
    console.log('✓ Basic query successful\n');

    // Test 2: Check tables exist
    console.log('[3/4] Checking required tables...');
    const tablesResult = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME IN ('Mx_ATDEventTrn', 'Mx_UserMst')
      ORDER BY TABLE_NAME
    `);

    if (tablesResult.recordset.length === 2) {
      console.log('✓ Required tables found:');
      tablesResult.recordset.forEach((row: any) => {
        console.log(`  - ${row.TABLE_NAME}`);
      });
      console.log();
    } else {
      console.log('⚠ Warning: Some tables missing');
      console.log(`  Found: ${tablesResult.recordset.map((r: any) => r.TABLE_NAME).join(', ')}\n`);
    }

    // Test 3: Count recent records
    console.log('[4/4] Checking recent attendance data...');
    const countResult = await pool.request().query(`
      SELECT
        COUNT(*) AS total_events,
        COUNT(DISTINCT UserID) AS unique_users,
        MIN(EDateTime) AS earliest_event,
        MAX(EDateTime) AS latest_event
      FROM Mx_ATDEventTrn WITH (NOLOCK)
      WHERE EDateTime >= DATEADD(DAY, -7, GETDATE())
    `);

    const stats = countResult.recordset[0];
    console.log('✓ Recent data (last 7 days):');
    console.log(`  Total Events:   ${stats.total_events?.toLocaleString() || 0}`);
    console.log(`  Unique Users:   ${stats.unique_users?.toLocaleString() || 0}`);
    console.log(`  Earliest Event: ${stats.earliest_event || 'N/A'}`);
    console.log(`  Latest Event:   ${stats.latest_event || 'N/A'}`);
    console.log();

    // Test 4: Sample punch data
    console.log('Sample Punch Records (Today):');
    const sampleResult = await pool.request().query(`
      SELECT TOP 5
        UserID,
        CAST(EDateTime AS DATE) AS punch_date,
        CAST(IDateTime AS TIME) AS punch_time,
        AccessLocationID
      FROM Mx_ATDEventTrn WITH (NOLOCK)
      WHERE CAST(EDateTime AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY IDateTime DESC
    `);

    if (sampleResult.recordset.length > 0) {
      console.log('┌────────────┬─────────────┬────────────┬──────────┐');
      console.log('│ UserID     │ Date        │ Time       │ Location │');
      console.log('├────────────┼─────────────┼────────────┼──────────┤');
      sampleResult.recordset.forEach((row: any) => {
        console.log(`│ ${(row.UserID || '').padEnd(10)} │ ${row.punch_date?.toISOString().slice(0, 10) || 'N/A'.padEnd(10)} │ ${row.punch_time || 'N/A'.padEnd(8)} │ ${(row.AccessLocationID || '').toString().padEnd(8)} │`);
      });
      console.log('└────────────┴─────────────┴────────────┴──────────┘\n');
    } else {
      console.log('  (No punch records found for today)\n');
    }

    console.log('┌────────────────────────────────────────────┐');
    console.log('│  ✅ ALL TESTS PASSED!                     │');
    console.log('│                                            │');
    console.log('│  COSEC database is ready for migration.   │');
    console.log('│  Next step: Run the migration script:     │');
    console.log('│                                            │');
    console.log('│  npx tsx scripts/migrate-ncosec-biometric.ts │');
    console.log('└────────────────────────────────────────────┘\n');

  } catch (error) {
    console.error('\n❌ Connection Failed!\n');

    if (error instanceof Error) {
      console.error('Error:', error.message);

      if (error.message.includes('timeout')) {
        console.error('\n💡 Troubleshooting:');
        console.error('   - Check if VPN is connected');
        console.error('   - Verify IP address: <NCOSEC_DB_HOST>');
        console.error('   - Check firewall rules');
        console.error('   - Try: telnet <NCOSEC_DB_HOST> 1433\n');
      } else if (error.message.includes('Login failed')) {
        console.error('\n💡 Troubleshooting:');
        console.error('   - Verify username: shivamg');
        console.error('   - Verify password');
        console.error('   - Check SQL Server authentication mode');
        console.error('   - Ensure user has permissions on NCOSEC database\n');
      } else if (error.message.includes('Database')) {
        console.error('\n💡 Troubleshooting:');
        console.error('   - Verify database name: NCOSEC');
        console.error('   - Check user has access to this database\n');
      }
    }

    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
      console.log('Connection closed.\n');
    }
  }
}

testConnection().catch(console.error);
