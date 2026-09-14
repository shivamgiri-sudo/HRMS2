/**
 * Backfills grn_request.attachment_original_name from db_bill's expense_entry_master.grn_file
 * for legacy rows. Filename only — the physical PDF/image was never copied off db_bill's own
 * application server onto this one, so attachment_path/attachment_file_path stay NULL and the
 * "Open" button stays honestly unavailable (see SmartGrnApprovalQueue.tsx's fallback UI). This
 * just stops the UI from showing nothing at all when a file is known to have existed.
 *
 * USAGE
 *   node backend/scripts/backfill-grn-legacy-attachment-name.cjs            # dry-run
 *   node backend/scripts/backfill-grn-legacy-attachment-name.cjs --apply    # write
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const TMP_TABLE = 'grn_legacy_attachment_name_backfill_tmp';

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: '192.168.10.22', port: process.env.BILL_DB_PORT,
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
  });

  try {
    const [grnRows] = await hrms.query(
      `SELECT id, bill_source_id FROM grn_request
       WHERE bill_source_id IS NOT NULL AND attachment_original_name IS NULL`
    );
    console.log(`Candidate rows (legacy, no attachment name yet): ${grnRows.length}`);

    const ids = grnRows.map(r => r.bill_source_id);
    const fileById = new Map();
    const chunkSize = 2000;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const [srcRows] = await bill.query(
        `SELECT Id, grn_file FROM expense_entry_master WHERE Id IN (${chunk.map(() => '?').join(',')})`,
        chunk
      );
      for (const r of srcRows) {
        const name = r.grn_file && String(r.grn_file).trim() ? String(r.grn_file).trim() : null;
        if (name) fileById.set(r.Id, name);
      }
    }

    const staged = grnRows
      .filter(g => fileById.has(g.bill_source_id))
      .map(g => [g.id, fileById.get(g.bill_source_id)]);
    console.log(`Rows with a known legacy filename: ${staged.length}`);

    if (!APPLY) {
      console.log('\nDRY RUN — no writes made. Re-run with --apply to write.');
      console.log('Sample:', staged.slice(0, 5));
      return;
    }

    await hrms.query(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
    await hrms.query(`
      CREATE TABLE ${TMP_TABLE} (
        grn_request_id CHAR(36) PRIMARY KEY,
        file_name VARCHAR(255) NULL
      ) ENGINE=InnoDB
    `);
    const insertChunk = 1000;
    for (let i = 0; i < staged.length; i += insertChunk) {
      const chunk = staged.slice(i, i + insertChunk);
      const placeholders = chunk.map(() => '(?,?)').join(',');
      await hrms.query(
        `INSERT INTO ${TMP_TABLE} (grn_request_id, file_name) VALUES ${placeholders}`,
        chunk.flat()
      );
    }

    const [result] = await hrms.query(`
      UPDATE grn_request g
      JOIN ${TMP_TABLE} t ON t.grn_request_id = g.id
      SET g.attachment_original_name = t.file_name
      WHERE g.attachment_original_name IS NULL
    `);
    console.log(`UPDATED: ${result.affectedRows} grn_request rows.`);
    await hrms.query(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('BACKFILL FAILED:', e); process.exit(1); });
