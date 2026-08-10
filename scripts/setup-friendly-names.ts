#!/usr/bin/env tsx
/**
 * Setup friendly branch names for candidate registration
 * Run with: cd backend && npx tsx ../scripts/setup-friendly-names.ts
 */

import { db } from '../backend/src/db/mysql.js';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

async function main() {
  console.log('\n🎨 Setting up friendly branch names...\n');

  // Step 1: Clean up incorrect OKAYA aliases
  console.log('Step 1: Removing incorrect OKAYA aliases...');
  const [deleted1] = await db.execute<ResultSetHeader>(
    `DELETE FROM ats_branch_alias_master
     WHERE canonical_key = 'OKAYA'
       AND NOT EXISTS (
         SELECT 1 FROM branch_master
         WHERE branch_name = 'OKAYA' AND active_status = 1
       )`
  );
  console.log(`  ✓ Deleted ${deleted1.affectedRows} incorrect OKAYA aliases\n`);

  // Step 2: Clean up inactive aliases
  console.log('Step 2: Removing old inactive aliases...');
  const [deleted2] = await db.execute<ResultSetHeader>(
    `DELETE FROM ats_branch_alias_master
     WHERE canonical_key NOT IN (
       SELECT branch_name FROM branch_master WHERE active_status = 1
     )`
  );
  console.log(`  ✓ Deleted ${deleted2.affectedRows} inactive aliases\n`);

  // Step 3: Update to friendly names
  console.log('Step 3: Setting up friendly display names...');

  const updates = [
    ['AHMEDABAD-JALDARSHAN', 'Jaldarshan - Ahmedabad', 'Ahmedabad Jaldarshan Gujarat'],
    ['AHMEDABAD-NEELAKANTH', 'Neelakanth - Ahmedabad', 'Ahmedabad Neelakanth Gujarat'],
    ['DELHI', 'Delhi Office', 'Delhi NCR Capital'],
    ['GENLEAP', 'Genleap', 'Genleap Center'],
    ['HEAD OFFICE', 'Head Office', 'HQ Headquarters Corporate'],
    ['NOIDA', 'Noida', 'Noida UP'],
    ['NOIDA ISPARK-2', 'ISpark 2 - Noida', 'Noida ISpark-2'],
    ['NOIDA-2', 'Noida 2', 'Noida Second Office'],
    ['NOIDA-DIALDESK', 'Dialdesk - Noida', 'Noida Dialdesk'],
  ];

  let updated = 0;
  for (const [canonical, display, alias] of updates) {
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE ats_branch_alias_master
         SET display_name = ?, alias_text = ?
         WHERE canonical_key = ? AND active_status = 1`,
        [display, alias, canonical]
      );
      if (result.affectedRows > 0) {
        updated++;
        console.log(`  ✓ ${canonical} → "${display}"`);
      }
    } catch (err) {
      console.log(`  ⚠ Failed to update ${canonical}:`, err);
    }
  }
  console.log(`\n  ✓ Updated ${updated} branch display names\n`);

  // Step 4: Show final result
  console.log('✅ Done! Current branch display names:\n');
  const [aliases] = await db.execute<RowDataPacket[]>(
    `SELECT
       canonical_key AS 'Database',
       display_name AS 'Candidates See',
       alias_text AS 'Keywords'
     FROM ats_branch_alias_master
     WHERE active_status = 1
     ORDER BY display_name`
  );
  console.table(aliases);

  console.log('\n✨ Candidates will now see these friendly names in the registration form!\n');

  await db.end();
}

main().catch(console.error);
