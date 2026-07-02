const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function run() {
  const conn = await mysql.createConnection({
    host: requiredEnv('BILL_DB_HOST'),
    port: Number(process.env.BILL_DB_PORT || 3306),
    user: requiredEnv('BILL_DB_USER'),
    password: requiredEnv('BILL_DB_PASSWORD'),
    database: requiredEnv('BILL_DB_NAME')
  });

  console.log('==================== masjclrentry (ACTIVE 32K employees) ====================\n');

  const [count] = await conn.execute('SELECT COUNT(*) as total FROM masjclrentry');
  console.log('Total rows:', count[0].total);

  // Check active/inactive breakdown
  const [statusBreakdown] = await conn.execute(`
    SELECT
      Status,
      COUNT(*) as count
    FROM masjclrentry
    GROUP BY Status
  `);
  console.log('\nStatus breakdown:');
  console.table(statusBreakdown);

  const [cols] = await conn.execute(`
    SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'db_bill' AND TABLE_NAME = 'masjclrentry'
    ORDER BY ORDINAL_POSITION
  `);

  console.log('\nTotal columns:', cols.length);
  console.table(cols);

  // Sample record to see data format
  console.log('\n\nSample record (first employee):');
  const [sample] = await conn.execute('SELECT * FROM masjclrentry LIMIT 1');
  if (sample.length > 0) {
    const record = sample[0];
    console.log('EmpCode:', record.EmpCode);
    console.log('BioCode:', record.BiometricCode);
    console.log('EmpName:', record.EmpName);
    console.log('DOJ:', record.DOJ);
    console.log('Status:', record.Status);
    console.log('lastUpdated:', record.lastUpdated);
    console.log('EntryDate:', record.EntryDate);
  }

  await conn.end();
}

run().catch(console.error);
