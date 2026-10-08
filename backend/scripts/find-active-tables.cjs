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

  console.log('ALL tables ordered by row count:');
  const [all] = await conn.execute(`
    SELECT
      TABLE_NAME,
      TABLE_ROWS,
      ROUND(DATA_LENGTH/1024/1024, 2) as SIZE_MB,
      UPDATE_TIME,
      CREATE_TIME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'db_bill'
      AND TABLE_ROWS > 100
    ORDER BY TABLE_ROWS DESC
    LIMIT 50
  `);
  console.table(all);

  console.log('\n\nTables with "mas" or "master" in name (likely core data):');
  const [masters] = await conn.execute(`
    SELECT TABLE_NAME, TABLE_ROWS, UPDATE_TIME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'db_bill'
      AND (TABLE_NAME LIKE '%mas%' OR TABLE_NAME LIKE '%master%')
      AND TABLE_ROWS > 100
    ORDER BY TABLE_ROWS DESC
    LIMIT 30
  `);
  console.table(masters);

  await conn.end();
}

run().catch(console.error);
