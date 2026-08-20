/**
 * One-time backfill: populates grn_request.legacy_raised_by_name / legacy_approved_by_name /
 * legacy_rejected_by_name (added by sql/1511_grn_legacy_identity_columns.sql) and
 * rejection_reason for all 84,767 legacy-migrated rows, resolved from db_bill's
 * expense_entry_master.{userid,ApprovedBy,RejectBy,RejectRemarks} -> user_master.DisplayName.
 *
 * Uses a bulk staging-table JOIN UPDATE rather than per-row round trips — 84,767 rows makes
 * individual UPDATEs impractically slow.
 *
 * RejectRemarks is verified NEVER populated across db_bill's full history (see 1511's header
 * comment) — rejection_reason will stay NULL for every row here. Not a bug in this script; the
 * source system never captured why something was rejected, only who and when.
 *
 * USAGE
 *   node backend/scripts/backfill-grn-legacy-identity.cjs            # dry-run
 *   node backend/scripts/backfill-grn-legacy-identity.cjs --apply    # write
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const TMP_TABLE = 'grn_legacy_identity_backfill_tmp';

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, multipleStatements: true,
  });
  const bill = await mysql.createConnection({
    host: '192.168.10.22', port: process.env.BILL_DB_PORT,
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
  });

  try {
    // Small lookup: db_bill.UserId -> DisplayName (~182 total, ~60 actually referenced by GRNs)
    const [userRows] = await bill.query(`SELECT UserId, DisplayName FROM user_master`);
    const nameById = new Map(userRows.map(r => [r.UserId, (r.DisplayName ?? '').trim() || null]));

    const [grnRows] = await hrms.query(
      `SELECT id, bill_source_id FROM grn_request WHERE bill_source_id IS NOT NULL`
    );
    console.log(`Legacy grn_request rows: ${grnRows.length}`);

    const ids = grnRows.map(r => r.bill_source_id);
    const srcById = new Map();
    const chunkSize = 2000;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const [srcRows] = await bill.query(
        `SELECT Id, userid, ApprovedBy, RejectBy, RejectRemarks
         FROM expense_entry_master WHERE Id IN (${chunk.map(() => '?').join(',')})`,
        chunk
      );
      for (const r of srcRows) srcById.set(r.Id, r);
    }
    console.log(`Matched source rows in db_bill: ${srcById.size}`);

    const staged = [];
    let withRaised = 0, withApproved = 0, withRejected = 0, withRemarks = 0;
    for (const g of grnRows) {
      const src = srcById.get(g.bill_source_id);
      if (!src) continue;
      const raised = src.userid != null ? nameById.get(src.userid) ?? null : null;
      const approved = src.ApprovedBy != null ? nameById.get(src.ApprovedBy) ?? null : null;
      const rejected = src.RejectBy != null ? nameById.get(src.RejectBy) ?? null : null;
      const remarks = src.RejectRemarks && String(src.RejectRemarks).trim() ? String(src.RejectRemarks).trim() : null;
      if (!raised && !approved && !rejected && !remarks) continue;
      if (raised) withRaised++;
      if (approved) withApproved++;
      if (rejected) withRejected++;
      if (remarks) withRemarks++;
      staged.push([g.id, raised, approved, rejected, remarks]);
    }
    console.log(`Rows to update: ${staged.length}`);
    console.log(`  with raised-by name:   ${withRaised}`);
    console.log(`  with approved-by name: ${withApproved}`);
    console.log(`  with rejected-by name: ${withRejected}`);
    console.log(`  with rejection remarks: ${withRemarks}`);

    if (!APPLY) {
      console.log('\nDRY RUN — no writes made. Re-run with --apply to write.');
      console.log('Sample of first 5 staged rows:', staged.slice(0, 5));
      return;
    }

    await hrms.query(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
    await hrms.query(`
      CREATE TABLE ${TMP_TABLE} (
        grn_request_id CHAR(36) PRIMARY KEY,
        raised_by_name VARCHAR(150) NULL,
        approved_by_name VARCHAR(150) NULL,
        rejected_by_name VARCHAR(150) NULL,
        reject_remarks TEXT NULL
      ) ENGINE=InnoDB
    `);

    const insertChunk = 1000;
    for (let i = 0; i < staged.length; i += insertChunk) {
      const chunk = staged.slice(i, i + insertChunk);
      const placeholders = chunk.map(() => '(?,?,?,?,?)').join(',');
      const flat = chunk.flat();
      await hrms.query(
        `INSERT INTO ${TMP_TABLE} (grn_request_id, raised_by_name, approved_by_name, rejected_by_name, reject_remarks)
         VALUES ${placeholders}`,
        flat
      );
    }
    console.log(`Staged ${staged.length} rows into ${TMP_TABLE}.`);

    const [result] = await hrms.query(`
      UPDATE grn_request g
      JOIN ${TMP_TABLE} t ON t.grn_request_id = g.id
      SET g.legacy_raised_by_name = t.raised_by_name,
          g.legacy_approved_by_name = t.approved_by_name,
          g.legacy_rejected_by_name = t.rejected_by_name,
          g.rejection_reason = COALESCE(g.rejection_reason, t.reject_remarks)
    `);
    console.log(`UPDATED: ${result.affectedRows} grn_request rows.`);

    await hrms.query(`DROP TABLE IF EXISTS ${TMP_TABLE}`);

    const [[check]] = await hrms.query(`
      SELECT
        SUM(legacy_raised_by_name IS NOT NULL) raised,
        SUM(legacy_approved_by_name IS NOT NULL) approved,
        SUM(legacy_rejected_by_name IS NOT NULL) rejected,
        SUM(rejection_reason IS NOT NULL) reasons
      FROM grn_request WHERE bill_source_id IS NOT NULL
    `);
    console.log('Post-backfill coverage:', check);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('BACKFILL FAILED:', e); process.exit(1); });
