// backend/scripts/migrate-legacy.ts
// Run: npx tsx scripts/migrate-legacy.ts
// Requires: .env file with DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
// Fill in LEGACY_SRC credentials in migrate-legacy.config.ts before running.

import { createConnection } from 'mysql2/promise';
import { LEGACY_SRC, DST, LEGACY_TABLES } from './migrate-legacy.config.js';
import { seedMasters } from './migrate-legacy.masters.js';
import { migrateEmployees } from './migrate-legacy.employees.js';
import { migrateLeave } from './migrate-legacy.leave.js';

async function main(): Promise<void> {
  console.log('=== Legacy Migration ETL ===');
  console.log('Target DB:', DST.database, '@', DST.host);
  console.log('Source DB:', LEGACY_SRC.database, '@', LEGACY_SRC.host);
  console.log('');

  // ── PHASE 0: Connect ────────────────────────────────────────────────────────
  console.log('[Phase 0] Connecting…');
  let src: Awaited<ReturnType<typeof createConnection>> | undefined;
  let dst: Awaited<ReturnType<typeof createConnection>> | undefined;
  try {
    src = await createConnection(LEGACY_SRC);
    console.log('  ✓ Source connected');
  } catch (err) {
    console.error('  ✗ Source connection failed:', err);
    console.error('  → Fill in LEGACY_SRC credentials in backend/scripts/migrate-legacy.config.ts');
    process.exit(1);
  }
  try {
    dst = await createConnection(DST);
    console.log('  ✓ Destination connected');
  } catch (err) {
    console.error('  ✗ Destination connection failed:', err);
    await src.end();
    process.exit(1);
  }

  // Verify source tables exist
  try {
    await src.execute(`SELECT 1 FROM ${LEGACY_TABLES.employees} LIMIT 1`);
    await src.execute(`SELECT 1 FROM ${LEGACY_TABLES.leave} LIMIT 1`);
    console.log('  ✓ Source tables verified');
  } catch (err) {
    console.error('  ✗ Source table check failed:', err);
    await src.end(); await dst.end();
    process.exit(1);
  }
  console.log('');

  // ── PHASE 1: Seed masters ───────────────────────────────────────────────────
  const masters = await seedMasters(src, dst, LEGACY_TABLES.employees);
  console.log('');

  // ── PHASE 2: Migrate employees ──────────────────────────────────────────────
  const empResult = await migrateEmployees(src, dst, LEGACY_TABLES.employees, masters);
  console.log('');

  // ── PHASE 3: Migrate leave ──────────────────────────────────────────────────
  const leaveResult = await migrateLeave(src, dst, LEGACY_TABLES.leave, masters);
  console.log('');

  // ── PHASE 4: Disconnect ─────────────────────────────────────────────────────
  await src.end();
  await dst.end();

  // ── PHASE 5: Summary ────────────────────────────────────────────────────────
  console.log('=== Migration Summary ===');
  console.log(`Employees : inserted=${empResult.inserted}  skipped=${empResult.skipped}  errors=${empResult.errors.length}`);
  console.log(`Leave     : inserted=${leaveResult.inserted}  skipped=${leaveResult.skipped}  errors=${leaveResult.errors.length}`);

  if (empResult.errors.length > 0) {
    console.log('\nEmployee errors:');
    empResult.errors.forEach(e => console.log(`  ${e.empCode}: ${e.error}`));
  }
  if (leaveResult.errors.length > 0) {
    console.log('\nLeave errors:');
    leaveResult.errors.forEach(e => console.log(`  id=${e.legacyId}: ${e.error}`));
  }

  const exitCode = (empResult.errors.length + leaveResult.errors.length) > 0 ? 1 : 0;
  console.log('\nDone.');
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
