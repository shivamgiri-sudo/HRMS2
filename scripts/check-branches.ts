#!/usr/bin/env tsx
/**
 * Script to check all branches and aliases in the database
 * Run with: npx tsx scripts/check-branches.ts
 */

import { db } from '../backend/src/db/mysql.js';
import type { RowDataPacket } from 'mysql2';

async function main() {
  console.log('\n=== ACTIVE BRANCHES FROM branch_master ===\n');

  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name, branch_code, active_status
     FROM branch_master
     WHERE active_status = 1
     ORDER BY branch_name`
  );

  console.table(branches);

  console.log('\n=== BRANCH ALIASES FROM ats_branch_alias_master ===\n');

  const [aliases] = await db.execute<RowDataPacket[]>(
    `SELECT
       canonical_key,
       display_name,
       alias_text,
       active_status,
       created_at
     FROM ats_branch_alias_master
     ORDER BY active_status DESC, display_name`
  );

  console.table(aliases);

  console.log('\n=== ALIASES POINTING TO NON-EXISTENT BRANCHES (ERRORS) ===\n');

  const [errors] = await db.execute<RowDataPacket[]>(
    `SELECT
       a.canonical_key AS alias_canonical,
       a.display_name AS alias_display,
       'NOT FOUND IN branch_master!' AS issue
     FROM ats_branch_alias_master a
     WHERE a.active_status = 1
       AND NOT EXISTS (
         SELECT 1
         FROM branch_master b
         WHERE b.branch_name = a.canonical_key
           AND b.active_status = 1
       )`
  );

  if (errors.length > 0) {
    console.table(errors);
    console.log('\n⚠️  WARNING: Found', errors.length, 'incorrect aliases!');
    console.log('Run: npx tsx scripts/fix-branch-aliases.ts');
  } else {
    console.log('✓ No errors found. All aliases point to valid branches.\n');
  }

  console.log('\n=== BRANCHES WITHOUT ALIASES ===\n');

  const [noAlias] = await db.execute<RowDataPacket[]>(
    `SELECT
       b.branch_name,
       'Will show as-is to candidates' AS note
     FROM branch_master b
     WHERE b.active_status = 1
       AND NOT EXISTS (
         SELECT 1
         FROM ats_branch_alias_master a
         WHERE a.canonical_key = b.branch_name
           AND a.active_status = 1
       )
     ORDER BY b.branch_name`
  );

  if (noAlias.length > 0) {
    console.table(noAlias);
    console.log('\nℹ️  These branches will display their official name to candidates.');
  } else {
    console.log('✓ All branches have aliases configured.\n');
  }

  await db.end();
}

main().catch(console.error);
