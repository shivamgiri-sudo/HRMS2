/**
 * fix-vendor-expense-mapping-complete.mjs
 *
 * Comprehensive backfill of vendor_expense_mapping for ALL DB_BILL vendors.
 *
 * The original backfill (fix-grn-head-vendor-alignment.mjs) used exact lowercase
 * name matching and missed ~26 sub-head name variants in db_bill that differ from
 * mas_hrms canonical names (year-suffixed COMPUTERS entries, typos, case mismatches,
 * trailing spaces, old aliases). This script applies a full alias map so every
 * mappable db_bill relation lands in mas_hrms.
 *
 * Safe: idempotent duplicate check before every INSERT. Rollback statements printed
 * at end. Run as: node backend/scripts/fix-vendor-expense-mapping-complete.mjs
 */

import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

const HRMS  = { host: '192.168.10.6',  port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'mas_hrms', connectTimeout: 10000 };
const DBBILL = { host: '192.168.10.22', port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'db_bill',  connectTimeout: 10000 };

// db_bill head name → mas_hrms canonical head_name
// Only entries that don't match by case-insensitive trim.
const HEAD_ALIAS = {
  'repairs & maintenance capex': 'Repairs & Maintenance - Capex',  // leading \t stripped before lookup; alias handles old non-hyphen variant
};

// db_bill sub-head name → mas_hrms canonical sub_head_name
// Applied after trimming; case-insensitive exact match is tried first, alias only used on failure.
const SUB_ALIAS = {
  // Year-versioned CAPEX computer cost variants → Computers - Cost
  'computers-2017-18 cost':         'Computers - Cost',
  'computers-2018-19 cost':         'Computers - Cost',
  'computers-2019-20 cost':         'Computers - Cost',
  'computers-2020-1 cost':          'Computers - Cost',
  'computers-2020-21 cost':         'Computers - Cost',
  'computers-2021-22':              'Computers - Cost',
  'computers-2021-22 cost':         'Computers - Cost',
  'computers-2022-23 cost':         'Computers - Cost',
  'computers-2023-24 cost':         'Computers - Cost',
  'computers 24-25 cost':           'Computers - Cost',
  'computers 25-26 cost':           'Computers - Cost',
  'computers 26-27 cost':           'Computers 26-27 Cost',

  // Year-versioned software cost variants → Computers - Software Cost
  'computer software-2017-18-cost': 'Computers - Software Cost',
  'computer software rental':       'Computers - Software Cost',   // trailing space stripped before key
  'computer software cost 2023 - 24': 'Computers - Software Cost',
  'computer software cost 2024 - 25': 'Computers - Software Cost',
  'computer software cost 2025 - 26': 'Computers - Software Cost',
  'computer software cost 2026 - 27': 'Computers - Software Cost',

  // Typos / formatting variants
  'airconditionng-cost':            'Air-Conditioning - Cost',
  'other-cost':                     'Other - Cost',
  'freighy & cargo charges':        'Freight & Cargo Charges',
  'generator  hire':                'Generator Hire',   // double space
  'ups - hire':                     'UPS Hire',
  'gateway hire':                   'Computer Hire',
  'furniture & fixtures repair a/c':'Furniture & Fixtures Repair',
  'newspaper & periodicals a/c':    'Newspaper & Periodicals',     // trailing space stripped

  // Spacing variants
  'ac- hire':                       'AC-Hire',   // db_bill has space before 'Hire'

  // Legacy name remappings (same as original SUB_NORM)
  'bank charges':                   'Fee & Subscription',
  'interest charges':               'Fee & Subscription',
  'sim purchase':                   'Company Owned Voice',
  'r & r expenses':                 'R&R Expenses',
  'software development charges':   'Computers - Software Cost',
};

// Sub-head values to skip entirely (no valid canonical target)
const SUB_SKIP = new Set([
  'professional tax 2022-23',
  'del',
  'agent',
  'bmc',
  'dsc',
]);

async function run() {
  const hrms  = await mysql.createConnection(HRMS);
  const dbbill = await mysql.createConnection(DBBILL);
  console.log('✓ Connected to mas_hrms and db_bill');

  // ── Load mas_hrms lookups ────────────────────────────────────────────────
  const [hrmsHeads]    = await hrms.execute('SELECT id, head_code, head_name FROM finance_expense_head_master WHERE active_status = 1');
  const [hrmsSubHeads] = await hrms.execute('SELECT id, sub_head_code, sub_head_name, head_id FROM finance_expense_sub_head_master WHERE active_status = 1');

  // Case-insensitive name → record
  const hrmsHeadByName = {};
  for (const r of hrmsHeads) hrmsHeadByName[r.head_name.trim().toLowerCase()] = r;

  const hrmsSubByName = {};
  for (const r of hrmsSubHeads) hrmsSubByName[r.sub_head_name.trim().toLowerCase()] = r;

  function resolveHead(raw) {
    const trimmed = raw.trim();
    const key = trimmed.toLowerCase();
    if (hrmsHeadByName[key]) return hrmsHeadByName[key];
    const aliasTarget = HEAD_ALIAS[key];
    if (aliasTarget) return hrmsHeadByName[aliasTarget.toLowerCase()];
    return null;
  }

  function resolveSub(raw) {
    const trimmed = raw.trim();
    const key = trimmed.toLowerCase();
    if (hrmsSubByName[key]) return hrmsSubByName[key];
    const aliasTarget = SUB_ALIAS[key];
    if (aliasTarget) return hrmsSubByName[aliasTarget.toLowerCase()];
    return null;
  }

  // ── Load all DB_BILL vendors in mas_hrms ─────────────────────────────────
  const [dbBillVendors] = await hrms.execute(`
    SELECT id as hrms_id, vendor_code, vendor_name,
           CAST(REPLACE(vendor_code, 'DB_BILL_', '') AS UNSIGNED) AS dbbill_id
    FROM vendor_master
    WHERE is_active = 1 AND vendor_code LIKE 'DB_BILL_%'
  `);
  console.log(`\n${dbBillVendors.length} active DB_BILL vendors in mas_hrms`);

  // ── Load db_bill head/subhead masters ─────────────────────────────────────
  const [dbHeads]    = await dbbill.execute('SELECT HeadingId, HeadingDesc FROM tbl_bgt_expenseheadingmaster');
  const [dbSubHeads] = await dbbill.execute('SELECT SubHeadingId, SubHeadingDesc FROM tbl_bgt_expensesubheadingmaster');

  const dbHeadMap = {};
  for (const r of dbHeads) dbHeadMap[String(r.HeadingId)] = r.HeadingDesc;
  const dbSubMap = {};
  for (const r of dbSubHeads) dbSubMap[String(r.SubHeadingId)] = r.SubHeadingDesc;

  // ── Load ALL vendor_expense_relation rows for DB_BILL vendors ─────────────
  const dbbillIds = dbBillVendors.map(v => v.dbbill_id).filter(Boolean);
  const placeholders = dbbillIds.map(() => '?').join(',');
  const [allRelations] = await dbbill.execute(
    `SELECT VendorId, HeadId, SubHeadId FROM vendor_expense_relation WHERE VendorId IN (${placeholders})`,
    dbbillIds
  );

  // Index by VendorId
  const relByVendor = {};
  for (const r of allRelations) {
    const k = String(r.VendorId);
    (relByVendor[k] ??= []).push(r);
  }

  console.log(`${allRelations.length} vendor_expense_relation rows across ${Object.keys(relByVendor).length} vendors`);

  // ── Load existing mappings to skip duplicates fast ────────────────────────
  const [existingMaps] = await hrms.execute(
    'SELECT vendor_id, head_code, sub_head_code FROM vendor_expense_mapping WHERE active_status = 1'
  );
  const existingSet = new Set(existingMaps.map(r => `${r.vendor_id}|${r.head_code}|${r.sub_head_code}`));
  console.log(`${existingSet.size} existing vendor_expense_mapping rows (active)`);

  // ── Process each vendor ──────────────────────────────────────────────────
  const rollback = [];
  let inserted = 0, skippedDup = 0, skippedNoHead = 0, skippedNoSub = 0, skippedJunk = 0, skippedNoRelation = 0;
  const SYSTEM_USER = '00000000-0000-0000-0000-000000000001';

  const unmatchedHeads = new Set();
  const unmatchedSubs  = new Set();

  for (const vendor of dbBillVendors) {
    const relations = relByVendor[String(vendor.dbbill_id)] ?? [];
    if (!relations.length) { skippedNoRelation++; continue; }

    for (const rel of relations) {
      const headRaw = dbHeadMap[String(rel.HeadId)];
      const subRaw  = dbSubMap[String(rel.SubHeadId)];
      if (!headRaw || !subRaw) continue;

      // Skip junk sub-heads
      if (SUB_SKIP.has(subRaw.trim().toLowerCase())) { skippedJunk++; continue; }

      const hrmsHead = resolveHead(headRaw);
      if (!hrmsHead) {
        unmatchedHeads.add(headRaw.trim());
        skippedNoHead++;
        continue;
      }

      const hrmsSub = resolveSub(subRaw);
      if (!hrmsSub) {
        unmatchedSubs.add(subRaw.trim());
        skippedNoSub++;
        continue;
      }

      const dupKey = `${vendor.hrms_id}|${hrmsHead.head_code}|${hrmsSub.sub_head_code}`;
      if (existingSet.has(dupKey)) { skippedDup++; continue; }

      const mapId = randomUUID();
      await hrms.execute(
        `INSERT INTO vendor_expense_mapping
           (id, vendor_id, head_id, head_code, sub_head_id, sub_head_code,
            active_status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
        [mapId, vendor.hrms_id, hrmsHead.id, hrmsHead.head_code,
         hrmsSub.id, hrmsSub.sub_head_code, SYSTEM_USER]
      );
      existingSet.add(dupKey); // prevent same combo inserted twice in this run
      rollback.push(`DELETE FROM vendor_expense_mapping WHERE id = '${mapId}'; -- ${vendor.vendor_name} | ${hrmsHead.head_code} | ${hrmsSub.sub_head_code}`);
      inserted++;
    }
  }

  await hrms.end();
  await dbbill.end();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Summary ──');
  console.log(`  Inserted:          ${inserted}`);
  console.log(`  Skipped (dup):     ${skippedDup}`);
  console.log(`  Skipped (no rel):  ${skippedNoRelation}`);
  console.log(`  Skipped (junk):    ${skippedJunk}`);
  console.log(`  Skipped (no head): ${skippedNoHead}`);
  console.log(`  Skipped (no sub):  ${skippedNoSub}`);

  if (unmatchedHeads.size) {
    console.log('\n⚠  Unmatched db_bill heads (add to HEAD_ALIAS if needed):');
    for (const h of unmatchedHeads) console.log(`    "${h}"`);
  }
  if (unmatchedSubs.size) {
    console.log('\n⚠  Unmatched db_bill sub-heads (add to SUB_ALIAS if needed):');
    for (const s of unmatchedSubs) console.log(`    "${s}"`);
  }

  if (rollback.length) {
    console.log('\n── Rollback (reverse order) ──');
    for (const stmt of rollback.reverse()) console.log(' ', stmt);
  }

  console.log('\n✅ Done.');
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
