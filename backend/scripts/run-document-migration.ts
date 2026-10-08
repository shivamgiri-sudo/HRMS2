/**
 * Runner: Employee Document Migration
 * Usage: npx tsx scripts/run-document-migration.ts
 *        (or: ts-node scripts/run-document-migration.ts)
 *
 * Requires DB env vars for both mas_hrms (DB_*) and db_bill (LEGACY_MYSQL_*).
 * Run backend/sql/migrations/100_employee_documents_migration_tracking.sql first.
 */

import { migrateDocumentsFromLegacy } from '../src/modules/migration/migrateDocumentsFromLegacy.js';

migrateDocumentsFromLegacy()
  .then((result) => {
    console.log('\nFinal result:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
