import { db } from "../src/db/mysql.js";

const PAGE_CODES = [
  'ATTENDANCE_BILLING_CONFIG','BENEFITS','CLIENT_MASTER',
  'COMPLIANCE_AUDIT_REPORT','EXIT_COMMAND_CENTER','LEAVE_TYPES',
  'MCNMEET','MOBILITY','PORTAL_DATA_MANAGER','PROCESS_CONFIG',
  'SUPPORT_COMMAND_CENTER'
];

// db.execute returns [rows, fields]
const [catalog] = await db.execute<any[]>(
  `SELECT page_code, page_name, active_status
   FROM page_catalog WHERE page_code IN (?)
   ORDER BY page_code`,
  [PAGE_CODES]
);

const [grants] = await db.execute<any[]>(
  `SELECT role_key, page_code,
          can_view, can_create, can_edit, can_delete, can_export, active_status
   FROM role_page_access
   WHERE page_code IN (?)
   ORDER BY page_code, role_key`,
  [PAGE_CODES]
);

console.log('\n=== page_catalog — existence + active_status ===');
if (catalog.length === 0) {
  console.log('  *** 0 rows — page codes not yet seeded in page_catalog ***');
} else {
  for (const r of catalog) {
    console.log(`  ${r.page_code.padEnd(34)} name="${r.page_name}"  active=${r.active_status}`);
  }
}

console.log('\n=== role_page_access — current grants (pre-migration) ===');
if (grants.length === 0) {
  console.log('  *** 0 rows for all 11 page codes ***');
} else {
  for (const r of grants) {
    console.log(`  ${r.page_code.padEnd(34)} role=${r.role_key.padEnd(16)} v=${r.can_view} c=${r.can_create} e=${r.can_edit} d=${r.can_delete} x=${r.can_export} active=${r.active_status}`);
  }
}

const countByPage: Record<string,number> = {};
for (const r of grants) {
  countByPage[r.page_code] = (countByPage[r.page_code] || 0) + 1;
}
console.log('\n=== Summary ===');
for (const pc of PAGE_CODES) {
  const n = countByPage[pc] ?? 0;
  console.log(`  ${pc.padEnd(34)} ${n} existing grant row(s)`);
}

const hasExtra = PAGE_CODES.filter(pc => (countByPage[pc] ?? 0) > 1);
if (hasExtra.length) {
  console.log('\n⚠️  Already has >1 grant (migration ON DUPLICATE KEY is still safe, no new rows needed):');
  hasExtra.forEach(pc => console.log('  ', pc));
} else {
  console.log('\n✅  Migration safe to apply — all 11 pages have ≤1 existing grant row.');
}

process.exit(0);
