#!/usr/bin/env tsx
/**
 * Script to fix incorrect branch aliases
 * Run with: npx tsx scripts/fix-branch-aliases.ts
 */

import { db } from '../backend/src/db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

async function main() {
  console.log('\n🔧 Fixing Branch Aliases...\n');

  // Step 1: Delete example aliases that don't match real branches
  console.log('Step 1: Removing example aliases...');
  const [deleted] = await db.execute<ResultSetHeader>(
    `DELETE FROM ats_branch_alias_master
     WHERE canonical_key IN (
       'Mumbai - Trapezoid',
       'Delhi - Okaya',
       'Bangalore - Corporate Office'
     )`
  );
  console.log(`  ✓ Deleted ${deleted.affectedRows} example aliases\n`);

  // Step 2: Get all active branches
  console.log('Step 2: Fetching active branches...');
  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name FROM branch_master WHERE active_status = 1`
  );
  console.log(`  ✓ Found ${branches.length} active branches\n`);

  // Step 3: Create 1:1 aliases for branches without them
  console.log('Step 3: Creating aliases for branches without them...');
  let created = 0;
  for (const branch of branches) {
    const branchName = branch.branch_name;
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
       VALUES (UUID(), ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         canonical_key = VALUES(canonical_key),
         active_status = VALUES(active_status)`,
      [branchName, branchName, branchName]
    );
    if (result.affectedRows > 0) created++;
  }
  console.log(`  ✓ Created ${created} new aliases\n`);

  // Step 4: Show final state
  console.log('✅ Done! Current aliases:\n');
  const [aliases] = await db.execute<RowDataPacket[]>(
    `SELECT
       canonical_key AS 'Official Name',
       display_name AS 'Candidates See',
       active_status AS 'Active'
     FROM ats_branch_alias_master
     WHERE active_status = 1
     ORDER BY display_name`
  );
  console.table(aliases);

  console.log('\n💡 To customize display names, edit them in the database:');
  console.log('   UPDATE ats_branch_alias_master');
  console.log("   SET display_name = 'Friendly Name'");
  console.log("   WHERE canonical_key = 'Official Branch Name';\n");

  await db.end();
}

main().catch(console.error);
