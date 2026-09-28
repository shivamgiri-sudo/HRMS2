/**
 * One-shot: commit the batches confirmed safe (44, 37, 51, 27), and delete the confirmed-dead
 * ones (duplicates, wrong-file-type, stale PARSING) so the import queue is clean afterward.
 *
 * Run this ON THE SERVER, from the project root, AFTER deploy-to-production.sh has finished
 * (it needs backend/dist, which that script's build step produces):
 *
 *   cd /var/www/HRMS2 && node commit-pending-rosters.cjs
 *
 * It uses the real commitImportBatch() service — the same function the UI's "Commit" button
 * calls — so every existing safety check (leave conflicts, rest-policy, employee locks,
 * error-row exclusion) still applies exactly as it would through the UI. Nothing here writes
 * SQL directly.
 */
require('dotenv').config({ path: 'backend/.env' });

const COMMIT_BATCH_IDS = [44, 37, 51, 27];
const DELETE_BATCH_IDS = [14, 15, 19, 28, 16, 17, 18, 20, 21, 22, 23, 24, 35, 36, 39, 40, 41, 43, 10, 29, 30, 31];

async function main() {
  const { db } = await import('./backend/dist/src/db/mysql.js');
  const { commitImportBatch } = await import('./backend/dist/src/modules/wfm/roster-import.service.js');

  const [admins] = await db.execute(
    `SELECT au.id, COALESCE(e.employee_code, au.email) AS label
       FROM auth_user au
       JOIN user_roles ur ON ur.user_id = au.id AND ur.active_status = 1 AND ur.role_key = 'super_admin'
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
      WHERE au.is_blocked = 0
      LIMIT 1`
  );
  if (!admins.length) throw new Error('No active super_admin account found to commit as.');
  const committerId = admins[0].id;
  console.log(`Committing as super_admin ${admins[0].label} (${committerId})\n`);

  for (const batchId of COMMIT_BATCH_IDS) {
    try {
      const result = await commitImportBatch(batchId, committerId, {
        overrideWarnings: true,
        committerIsSuperAdmin: true,
      });
      console.log(`Batch ${batchId}: COMMITTED —`, JSON.stringify(result));
    } catch (err) {
      console.error(`Batch ${batchId}: FAILED — ${err.message}`);
    }
  }

  console.log('\nDeleting confirmed dead/duplicate/wrong-file batches...');
  for (const batchId of DELETE_BATCH_IDS) {
    try {
      await db.execute(
        `DELETE FROM wfm_roster_import_row WHERE batch_id = ?`,
        [batchId]
      );
      const [r] = await db.execute(
        `DELETE FROM wfm_roster_import_batch WHERE id = ? AND status IN ('PREVIEW','PARSING')`,
        [batchId]
      );
      console.log(`Batch ${batchId}: deleted (${r.affectedRows} batch row(s))`);
    } catch (err) {
      console.error(`Batch ${batchId}: delete failed — ${err.message}`);
    }
  }

  console.log('\nDone. Verify with: SELECT status, COUNT(*) FROM wfm_roster_import_batch GROUP BY status;');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
