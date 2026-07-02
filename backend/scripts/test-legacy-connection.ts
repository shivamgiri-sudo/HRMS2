import dotenv from 'dotenv';
import { testLegacyConnection, closeLegacyPool } from '../src/db/legacyDb.js';

dotenv.config();

async function main() {
  console.log('Testing legacy SQL Server connection...');
  console.log('Host:', process.env.LEGACY_MSSQL_HOST);
  console.log('Port:', process.env.LEGACY_MSSQL_PORT);
  console.log('Database:', process.env.LEGACY_MSSQL_DATABASE);
  console.log('User:', process.env.LEGACY_MSSQL_USER);
  console.log();

  const result = await testLegacyConnection();

  if (result.ok) {
    console.log('✅ Connection successful!');
    process.exit(0);
  } else {
    console.error('❌ Connection failed:', result.error);
    process.exit(1);
  }
}

main().finally(() => closeLegacyPool());
