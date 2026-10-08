// verify-435.mjs — run from backend/ dir: node scripts/verify-435.mjs
// Checks page_catalog and role_page_access for the 11 D011 page codes
// Uses a single-use connection (no pool) to avoid long init time.

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const PAGE_CODES = [
  'ATTENDANCE_BILLING_CONFIG', 'BENEFITS', 'CLIENT_MASTER',
  'COMPLIANCE_AUDIT_REPORT',   'EXIT_COMMAND_CENTER', 'LEAVE_TYPES',
  'MCNMEET', 'MOBILITY',       'PORTAL_DATA_MANAGER', 'PROCESS_CONFIG',
  'SUPPORT_COMMAND_CENTER',
];

const conn = await mysql.createConnection({
  host:            process.env.DB_HOST,
  port:            Number(process.env.DB_PORT ?? 3306),
  user:            process.env.DB_USER,
  password:        process.env.DB_PASSWORD,
  database:        process.env.DB_NAME ?? 'mas_hrms',
  connectTimeout:  10000,
});

console.log(`\nConnected to ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306} (${process.env.DB_NAME ?? 'mas_hrms'})`);

// 1. page_catalog presence
const [catalog] = await conn.query(
  'SELECT page_code, page_name, active_status FROM page_catalog WHERE page_code IN (?) ORDER BY page_code',
  [PAGE_CODES]
);
console.log(`\n=== page_catalog (${catalog.length}/11 found) ===`);
const catalogCodes = new Set(catalog.map(r => r.page_code));
for (const r of catalog) {
  console.log(`  ${r.page_code.padEnd(34)} name="${r.page_name}"  active=${r.active_status}`);
}
const missing = PAGE_CODES.filter(c => !catalogCodes.has(c));
if (missing.length) console.log(`  MISSING from page_catalog: ${missing.join(', ')}`);

// 2. role_page_access current state
const [grants] = await conn.query(
  `SELECT role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status
   FROM role_page_access WHERE page_code IN (?) ORDER BY page_code, role_key`,
  [PAGE_CODES]
);
console.log(`\n=== role_page_access current grants (${grants.length} rows) ===`);
if (!grants.length) {
  console.log('  0 rows — all 11 page codes are super_admin-only via catalog default (no explicit rows needed)');
} else {
  for (const r of grants) {
    console.log(`  ${r.page_code.padEnd(34)} role=${String(r.role_key).padEnd(20)} v=${r.can_view} c=${r.can_create} e=${r.can_edit} d=${r.can_delete} x=${r.can_export} active=${r.active_status}`);
  }
}

// 3. Per-page summary
console.log('\n=== Per-page grant count (pre-migration state) ===');
const cnt = {};
for (const r of grants) cnt[r.page_code] = (cnt[r.page_code] ?? 0) + 1;
for (const pc of PAGE_CODES) {
  const n = cnt[pc] ?? 0;
  const note = n === 0 ? '← no rows (super_admin bypass only)' : n === 1 ? '← 1 row (likely super_admin only — migration will add more)' : '';
  console.log(`  ${pc.padEnd(34)} ${String(n).padStart(2)} rows  ${note}`);
}

// 4. verdict
const totalGrants = PAGE_CODES.reduce((s, pc) => s + (cnt[pc] ?? 0), 0);
const catalogOk = catalogCodes.size === 11 && missing.length === 0;
console.log('\n=== Verdict ===');
console.log(`  page_catalog:     ${catalogOk ? 'OK — all 11 present and accounted for' : 'PROBLEM — see MISSING list above'}`);
console.log(`  pre-migration:    ${totalGrants <= 11 ? 'CLEAN — ≤1 row per page (super_admin or none); migration 435 applies safely' : 'REVIEW — multiple roles already have grants for some pages; check above'}`);

await conn.end();
