import { getNcosecPool } from './src/db/ncosecDb.js';

async function main() {
  try {
    const pool = await getNcosecPool();
    console.log('✓ Connected to NCOSEC\n');

    // Get all tables
    const tables = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE='BASE TABLE'
      ORDER BY TABLE_NAME
    `);

    console.log('=== ALL NCOSEC TABLES ===\n');
    const allTables = tables.recordset.map((r: any) => r.TABLE_NAME);
    allTables.forEach(t => console.log(`  ${t}`));

    // Filter to attendance-related
    const keywords = ['atd', 'attend', 'punch', 'summary', 'bio'];
    const relevant = allTables.filter(t => 
      keywords.some(kw => t.toLowerCase().includes(kw))
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
      cols.recordset.forEach((c: any) => {
        console.log(`${c.COLUMN_NAME.padEnd(30)} ${c.DATA_TYPE.padEnd(25)} ${c.IS_NULLABLE}`);
      });

      const count = await pool.request().query(
        `SELECT COUNT(*) as cnt FROM [${tableName}]`
      );
      console.log(`\nRow count: ${count.recordset[0].cnt.toLocaleString()}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
