import { getNcosecPool } from './src/db/ncosecDb.js';

type TableRow = { TABLE_NAME: string };
type ColumnRow = { COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string };
type CountRow = { cnt: number };

async function main() {
  try {
    const pool = await getNcosecPool();
    console.log('Connected to NCOSEC\n');

    const tables = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE='BASE TABLE'
      ORDER BY TABLE_NAME
    `);

    console.log('=== ALL NCOSEC TABLES ===\n');
    const allTables = (tables.recordset as TableRow[]).map(row => row.TABLE_NAME);
    allTables.forEach(tableName => console.log(`  ${tableName}`));

    const keywords = ['atd', 'attend', 'punch', 'summary', 'bio'];
    const relevant = allTables.filter(tableName =>
      keywords.some(keyword => tableName.toLowerCase().includes(keyword))
    );

    console.log(`\n\n=== ${relevant.length} ATTENDANCE-RELATED TABLES ===\n`);

    for (const tableName of relevant) {
      console.log(`\n${tableName}:`);
      console.log('='.repeat(80));

      const cols = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
      `);

      console.log(`${'Column'.padEnd(30)} ${'Type'.padEnd(25)} ${'Null'}`);
      console.log('-'.repeat(70));
      (cols.recordset as ColumnRow[]).forEach(column => {
        console.log(`${column.COLUMN_NAME.padEnd(30)} ${column.DATA_TYPE.padEnd(25)} ${column.IS_NULLABLE}`);
      });

      const count = await pool.request().query(`SELECT COUNT(*) as cnt FROM [${tableName}]`);
      console.log(`\nRow count: ${(count.recordset[0] as CountRow).cnt.toLocaleString()}`);
    }

    process.exit(0);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error:', message);
    process.exit(1);
  }
}

main();
