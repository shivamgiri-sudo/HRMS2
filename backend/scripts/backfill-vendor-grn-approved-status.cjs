/**
 * One-time backfill: fixes the bug in migrate-grn-from-dbbill.ts's resolveStatus() that filed
 * already-approved legacy vendor GRNs as 'submitted' (Branch Head Queue) instead of
 * 'finance_head_approved'. See backend/scripts/migrate-grn-from-dbbill.ts for the code fix and
 * full explanation.
 *
 * Scope: grn_request rows where grn_type='vendor', status='submitted', bill_source_id IS NOT
 * NULL, and db_bill's expense_entry_master.ApprovalDate is set for that bill_source_id.
 *
 * Saves the full before-state (id, bill_source_id, old status) to a JSON file before writing,
 * so the change is reversible by id list.
 *
 * USAGE
 *   node backend/scripts/backfill-vendor-grn-approved-status.cjs            # dry-run
 *   node backend/scripts/backfill-vendor-grn-approved-status.cjs --apply    # write
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const NEW_STATUS = 'finance_head_approved';
const OUT_FILE = path.join(__dirname, `backfill-vendor-grn-${Date.now()}.json`);

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  // Public BILL_DB_HOST timed out from this network; LAN pair (192.168.10.22) works — see
  // backend/.env's comment on the LAN/public host pairs.
  const bill = await mysql.createConnection({
    host: '192.168.10.22', port: process.env.BILL_DB_PORT,
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
  });

  try {
    const [rows] = await hrms.query(
      `SELECT id, bill_source_id, status FROM grn_request
       WHERE grn_type = 'vendor' AND status = 'submitted' AND bill_source_id IS NOT NULL`
    );
    console.log(`Candidate vendor rows at status='submitted': ${rows.length}`);

    const ids = rows.map(r => r.bill_source_id);
    const approvedBillSourceIds = new Set();
    const chunkSize = 2000;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const [srcRows] = await bill.query(
        `SELECT Id FROM expense_entry_master
         WHERE Id IN (${chunk.map(() => '?').join(',')})
           AND RejectDate IS NULL
           AND (ApprovalDate IS NOT NULL OR approved_by_ph_date IS NOT NULL OR approved_by_fh_date IS NOT NULL)`,
        chunk
      );
      for (const r of srcRows) approvedBillSourceIds.add(r.Id);
    }

    const toUpdate = rows.filter(r => approvedBillSourceIds.has(r.bill_source_id));
    console.log(`Rows confirmed already-approved in db_bill: ${toUpdate.length}`);
    console.log(`Rows left untouched (genuinely still pending): ${rows.length - toUpdate.length}`);

    fs.writeFileSync(OUT_FILE, JSON.stringify({
      generated_at: new Date().toISOString(),
      new_status: NEW_STATUS,
      old_status: 'submitted',
      rows: toUpdate,
    }, null, 2));
    console.log(`Before-state saved to ${OUT_FILE}`);

    if (!APPLY) {
      console.log('\nDRY RUN — no writes made. Re-run with --apply to write.');
      return;
    }

    const updateIds = toUpdate.map(r => r.id);
    let updated = 0;
    for (let i = 0; i < updateIds.length; i += chunkSize) {
      const chunk = updateIds.slice(i, i + chunkSize);
      const [result] = await hrms.query(
        `UPDATE grn_request SET status = ? WHERE id IN (${chunk.map(() => '?').join(',')}) AND status = 'submitted'`,
        [NEW_STATUS, ...chunk]
      );
      updated += result.affectedRows;
    }
    console.log(`\nUPDATED: ${updated} rows set to status='${NEW_STATUS}'.`);

    const [[check]] = await hrms.query(
      `SELECT COUNT(*) cnt FROM grn_request WHERE grn_type='vendor' AND status='submitted'`
    );
    console.log(`Vendor rows still at status='submitted' after backfill: ${check.cnt}`);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('BACKFILL FAILED:', e); process.exit(1); });
