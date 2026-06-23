import mysql from 'mysql2/promise';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function testConnection() {
  console.log('Testing legacy MySQL connection...');
  console.log(`Host: ${requiredEnv('BILL_DB_HOST')}`);
  console.log(`Port: ${process.env.BILL_DB_PORT || '3306'}`);
  console.log(`Database: ${requiredEnv('BILL_DB_NAME')}`);
  console.log(`User: ${requiredEnv('BILL_DB_USER')}\n`);

  try {
    const connection = await mysql.createConnection({
      host: requiredEnv('BILL_DB_HOST'),
      port: Number(process.env.BILL_DB_PORT || 3306),
      user: requiredEnv('BILL_DB_USER'),
      password: requiredEnv('BILL_DB_PASSWORD'),
      database: requiredEnv('BILL_DB_NAME'),
      connectTimeout: 10000,
    });

    console.log('✅ Connected successfully!\n');

    // Test query
    const [rows] = await connection.execute('SELECT DATABASE() as db, VERSION() as version, NOW() as now');
    console.log('Database info:', rows);

    // List tables
    const [tables] = await connection.execute(`
      SELECT TABLE_NAME, TABLE_ROWS, CREATE_TIME, UPDATE_TIME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'db_bill'
      ORDER BY TABLE_ROWS DESC
      LIMIT 10
    `);
    console.log('\nTop 10 tables by row count:');
    console.table(tables);

    await connection.end();
    console.log('\n✅ Connection test complete!');
  } catch (error: any) {
    console.error('\n❌ Connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
