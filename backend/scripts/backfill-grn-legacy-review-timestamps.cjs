/**
 * Follow-up to backfill-grn-legacy-identity.cjs. GrnHistoryTable's StageCell decides
 * "Pending" vs "shows the name" purely off branch_head_reviewed_at / finance_head_reviewed_at
 * being non-NULL — the legacy_approved_by_name text backfill alone did not touch those
 * timestamp columns, so a legacy vendor GRN correctly marked 'finance_head_approved'/'paid'
 * would still render "Pending" in the Finance Head column despite the name now being known.
 *
 * Backfills finance_head_reviewed_at (vendor/salary) / branch_head_reviewed_at (imprest) from
 * db_bill's ApprovalDate, only where the column is currently NULL and a legacy approver name
 * was set — i.e. only for rows genuinely already approved in db_bill, matching exactly which
 * rows carry legacy_approved_by_name.
 *
 * USAGE
 *   node backend/scripts/backfill-grn-legacy-review-timestamps.cjs            # dry-run
 *   node backend/scripts/backfill-grn-legacy-review-timestamps.cjs --apply    # write
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const TMP_TABLE = 'grn_legacy_review_ts_backfill_tmp';

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
      `SELECT id, bill_source_id, grn_type
       FROM grn_request
       WHERE bill_source_id IS NOT NULL AND legacy_approved_by_name IS NOT NULL
         AND ((grn_type = 'imprest' AND branch_head_reviewed_at IS NULL)
           OR (grn_type <> 'imprest' AND finance_head_reviewed_at IS NULL))`
    );
    console.log(`Candidate rows (approved, missing review timestamp): ${grnRows.length}`);

    const ids = grnRows.map(r => r.bill_source_id);
    const dateById = new Map();
    const chunkSize = 2000;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const [srcRows] = await bill.query(
        `SELECT Id, ApprovalDate FROM expense_entry_master WHERE Id IN (${chunk.map(() => '?').join(',')})`,
        chunk
      );
      for (const r of srcRows) if (r.ApprovalDate) dateById.set(r.Id, r.ApprovalDate);
    }

    const staged = grnRows
      .filter(g => dateById.has(g.bill_source_id))
      .map(g => [g.id, g.grn_type === 'imprest' ? dateById.get(g.bill_source_id) : null,
                        g.grn_type !== 'imprest' ? dateById.get(g.bill_source_id) : null]);
    console.log(`Rows with a resolvable ApprovalDate: ${staged.length}`);

    if (!APPLY) {
      console.log('\nDRY RUN — no writes made. Re-run with --apply to write.');
      return;
    }

    await hrms.query(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
    await hrms.query(`
      CREATE TABLE ${TMP_TABLE} (
        grn_request_id CHAR(36) PRIMARY KEY,
        branch_head_at DATETIME NULL,
        finance_head_at DATETIME NULL
      ) ENGINE=InnoDB
    `);
    const insertChunk = 1000;
    for (let i = 0; i < staged.length; i += insertChunk) {
      const chunk = staged.slice(i, i + insertChunk);
      const placeholders = chunk.map(() => '(?,?,?)').join(',');
      await hrms.query(
        `INSERT INTO ${TMP_TABLE} (grn_request_id, branch_head_at, finance_head_at) VALUES ${placeholders}`,
        chunk.flat()
      );
    }

    const [result] = await hrms.query(`
      UPDATE grn_request g
      JOIN ${TMP_TABLE} t ON t.grn_request_id = g.id
      SET g.branch_head_reviewed_at = COALESCE(g.branch_head_reviewed_at, t.branch_head_at),
          g.finance_head_reviewed_at = COALESCE(g.finance_head_reviewed_at, t.finance_head_at)
    `);
    console.log(`UPDATED: ${result.affectedRows} grn_request rows.`);
    await hrms.query(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('BACKFILL FAILED:', e); process.exit(1); });
