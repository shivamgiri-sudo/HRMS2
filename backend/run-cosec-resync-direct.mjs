#!/usr/bin/env node
/**
 * Calls cosecSyncService.sync() directly — no HTTP, no auth needed.
 * Must run from /var/www/HRMS2/backend where dist/ is built.
 * Usage: node backend/run-cosec-resync-direct.mjs 2026-07-01 2026-07-14
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env before importing compiled service
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const FROM = process.argv[2] || '2026-07-01';
const TO   = process.argv[3] || '2026-07-14';

console.log(`\n=== COSEC Direct Re-Sync (no HTTP) ===`);
console.log(`Range: ${FROM} → ${TO}`);
console.log(`Source mode: ${process.env.NCOSEC_SOURCE_MODE}`);
console.log('');

// Import the compiled service
const { cosecSyncService } = await import('./dist/src/modules/wfm/cosec-sync.service.js');

const result = await cosecSyncService.sync({ from: FROM, to: TO });

console.log('\nSync complete:');
console.log(`  success      : ${result.success}`);
console.log(`  pulled events: ${result.pulledEvents}`);
console.log(`  grouped days : ${result.groupedDays}`);
console.log(`  migrated days: ${result.migratedDays}`);
if (result.unmappedUsers?.length) {
  console.log(`  unmapped     : ${result.unmappedUsers.length}`);
  result.unmappedUsers.slice(0, 10).forEach(u => console.log(`    ${u.cosecUserId} ${u.punchDate}`));
}
if (result.failed?.length) {
  console.log(`  failed       : ${result.failed.length}`);
  result.failed.slice(0, 10).forEach(f => console.log(`    ${f.cosecUserId} ${f.punchDate}: ${f.error}`));
}

process.exit(0);
