/**
 * fix-grn-head-vendor-alignment.mjs
 *
 * Fixes 4 alignment gaps in mas_hrms GRN / vendor head-subhead data:
 *  1. Add missing heads to finance_expense_head_master
 *  2. Normalize orphan head names in grn_request (typos/variant names → canonical)
 *  3. Normalize orphan sub-head names in grn_request
 *  4. Backfill vendor_expense_mapping for 614 unmapped active vendors (from db_bill)
 *
 * Run: node backend/scripts/fix-grn-head-vendor-alignment.mjs
 * Safe: read-before-write, duplicate-safe upserts, rollback log printed at end.
 */

import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

const HRMS = { host: '192.168.10.6', port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'mas_hrms' };
const DBBILL = { host: '192.168.10.22', port: 3306, user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'db_bill' };

// ── 1. Heads to add to finance_expense_head_master ──────────────────────────
const MISSING_HEADS = [
  { head_code: 'SALARY_WORKMAN_COMP',  head_name: 'Salary & Workman Compensation', display_order: 240 },
  { head_code: 'FINANCE_EXPENSES',     head_name: 'Finance Expenses',              display_order: 250 },
  { head_code: 'DUTIES_TAXES',         head_name: 'Duties and Taxes',              display_order: 260 },
];

// ── 2. Head name normalizations for grn_request.head ────────────────────────
const HEAD_NORM = {
  'Staff Walfare Expenses':          'Staff Welfare',
  'Travelling':                      'Tours, Travelling & Conveyance',
  'Repair and Maintanance':          'Repairs & Maintenance',
  'Office Maintenance':              'Office Maintenance A/c',
  'Printing and Stationery Expenses':'Printing & Stationery Expenses',
  'Sales Promotion Expenses':        'Business Promotion Expenses',
  'Repairs & Maintenance Capex':     'Repairs & Maintenance - Capex',
  'Staff Training and Recruitment':  'Staff Training & Recruitment',
  'Contract Fees-Others':            'CONTRACT FEES',
  'Sales Promotion Incentive':       'Spot/Floor/Field Incentive',
  'Miscellaneous Expenses':          'Others',
  'Outsourcing Exp.':                'CONTRACT FEES',
};

// ── 3. Sub-head name normalizations for grn_request.sub_head ────────────────
const SUB_NORM = {
  'Co.owned Voice':                           'Company Owned Voice',
  'Generator  Hire':                          'Generator Hire',
  'Co.owned Data':                            'Company Owned Data',
  'Employee Reimbursement':                   'Mobile & Internet Reimbursement',
  'Electricity -Govt.':                       'Electricity Govt.',
  'Travelling':                               'Tour Expenses',
  'COMPUTERS-2022-23 COST':                   'Computers - Cost',
  'COMPUTERS-2021-22 COST':                   'Computers - Cost',
  'COMPUTERS-2018-19 COST':                   'Computers - Cost',
  'COMPUTERS-2019-20 COST':                   'Computers - Cost',
  'COMPUTERS-2020-21 COST':                   'Computers - Cost',
  'COMPUTERS-2020-1 COST':                    'Computers - Cost',
  'COMPUTERS-2017-18 COST':                   'Computers - Cost',
  'COMPUTERS-2023-24 COST':                   'Computers - Cost',
  'Computers 25-26 COST':                     'Computers - Cost',
  'Computers 24-25 COST':                     'Computers - Cost',
  'Recruitment Advertisement charges-PO':     'Recruitment Advertisement Charges',
  'Postage,Courier, Frieght  & Cargo-PO':     'Postage & Courier Expenses',
  'Computer and Peripherals-PO':              'Computer & Peripherals Maintenance',
  'Office Stationery-PO':                     'Office Stationery',
  'UPS - Hire':                               'UPS Hire',
  'Genset Hire':                              'Generator Hire',
  'Drinking water-PO':                        'Drinking Water',
  'Computer Hire-PO':                         'Computer Hire',
  'Tour':                                     'Tour Expenses',
  'Primary Connectivity-Reimbursement':       'Mobile & Internet Reimbursement',
  'Sweeper & Cleansing Materials':            'Sweeper & Cleaning Materials',
  'Furniture & Fixtures Repair A/c':          'Furniture & Fixtures Repair',
  'Tea & Coffee-PO':                          'Tea, Coffee & Refreshment',
  'Facility Staff':                           'Contract Fees-Facility Staff',
  'Generator -Diesel':                        'Generator-Diesel',
  'Generator -Diesel-PO':                     'Generator-Diesel',
  'AC- Hire':                                 'AC-Hire',
  'Air-Condition':                            'R&M - Air Conditioner',
  'Air-Condition-AMC':                        'R&M - Air Conditioner',
  'GATEWAY HIRE':                             'Computer Hire',
  'Electrical Repair & Maintenance':          'Electrical Repairs & Maintenance',
  'Local Conveyance':                         'Local Conveyance A/c',
  'Local Conveyance-PO':                      'Local Conveyance A/c',
  'Electrical Installation-PO':              'Electrical Installations - Cost',
  'Electrical Installation':                  'Electrical Installations - Cost',
  'Computer and Peripherals':                 'Computer & Peripherals Maintenance',
  'Computer and Peripherals Repair':          'Computer & Peripherals Maintenance',
  'Photocopy-PO':                             'Photocopy',
  'AIRCONDITIONNG-COST':                      'Air-Conditioning - Cost',
  'OTHER-COST':                               'Other - Cost',
  'UPS Networking':                           'R&M- Ups Networking Equipment',
  'Travelling-PO':                            'Tour Expenses',
  'COMPUTER SOFTWARE-2017-18-COST':           'Computers - Software Cost',
  'Computer Software Cost 2024 - 25':         'Computers - Software Cost',
  'Computer Software Cost 2025 - 26':         'Computers - Software Cost',
  'Computer Software Cost 2023 - 24':         'Computers - Software Cost',
  'COMPUTER SOFTWARE RENTAL':                 'COMPUTER SOFTWARE RENTAL ',
  'Festival Expenses':                        'Festival Exp.',
  'Tea & Coffee':                             'Tea, Coffee & Refreshment',
  'SIM PURCHASE':                             'Company Owned Voice',
  'SMS Charges Unicel':                       'SMS Charges',
  'Furniture & Fixtures-PO':                  'Furniture & Fixture - Cost',
  'Legal Consulatancy Fees':                  'Legal & Professional Charges',
  'Newspaper & Periodicals A/c':              'Newspaper & Periodicals',
  'R & R Expenses':                           'R&R Expenses',
  'Software Development Charges':             'Computers - Software Cost',
  'Bank Charges':                             'Fee & Subscription',
  'Interest Charges':                         'Fee & Subscription',
};

// Junk values to NULL out
const SUB_NULL = new Set(['del', 'Professional Tax 2022-23']);

async function run() {
  const hrms = await mysql.createConnection({ ...HRMS, connectTimeout: 10000 });
  console.log('✓ Connected to mas_hrms');

  const rollback = [];
  let totalChanged = 0;

  // ── Fix 1: Add missing heads ─────────────────────────────────────────────
  console.log('\n── Fix 1: Adding missing expense heads ──');
  for (const h of MISSING_HEADS) {
    const [existing] = await hrms.execute(
      'SELECT id FROM finance_expense_head_master WHERE head_code = ? OR head_name = ? LIMIT 1',
      [h.head_code, h.head_name]
    );
    if (existing.length) {
      console.log(`  SKIP (exists): ${h.head_name}`);
      continue;
    }
    const id = randomUUID();
    await hrms.execute(
      `INSERT INTO finance_expense_head_master
         (id, head_code, head_name, description, display_order, active_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [id, h.head_code, h.head_name, `Migrated from db_bill legacy data`, h.display_order]
    );
    rollback.push(`DELETE FROM finance_expense_head_master WHERE id = '${id}';`);
    console.log(`  ADDED: ${h.head_name} (${h.head_code})`);
    totalChanged++;
  }

  // ── Fix 2: Normalize head names in grn_request ───────────────────────────
  console.log('\n── Fix 2: Normalizing orphan head names in grn_request ──');
  for (const [from, to] of Object.entries(HEAD_NORM)) {
    const [cnt] = await hrms.execute(
      'SELECT COUNT(*) as n FROM grn_request WHERE head = ?', [from]
    );
    const n = cnt[0].n;
    if (!n) { console.log(`  SKIP (0 rows): "${from}"`); continue; }
    await hrms.execute('UPDATE grn_request SET head = ?, updated_at = NOW() WHERE head = ?', [to, from]);
    rollback.push(`UPDATE grn_request SET head = '${from}', updated_at = NOW() WHERE head = '${to}'; -- was: ${n} rows (partial rollback only)`);
    console.log(`  UPDATED ${n} rows: "${from}" → "${to}"`);
    totalChanged += n;
  }

  // ── Fix 3: Normalize sub-head names in grn_request ───────────────────────
  console.log('\n── Fix 3: Normalizing orphan sub-head names in grn_request ──');
  for (const [from, to] of Object.entries(SUB_NORM)) {
    const [cnt] = await hrms.execute(
      'SELECT COUNT(*) as n FROM grn_request WHERE sub_head = ?', [from]
    );
    const n = cnt[0].n;
    if (!n) { console.log(`  SKIP (0 rows): "${from}"`); continue; }
    await hrms.execute('UPDATE grn_request SET sub_head = ?, updated_at = NOW() WHERE sub_head = ?', [to, from]);
    rollback.push(`UPDATE grn_request SET sub_head = '${from}', updated_at = NOW() WHERE sub_head = '${to}'; -- was: ${n} rows`);
    console.log(`  UPDATED ${n} rows: "${from}" → "${to}"`);
    totalChanged += n;
  }
  // Clear junk sub-head values to empty string (column is NOT NULL)
  for (const junk of SUB_NULL) {
    const [cnt] = await hrms.execute('SELECT COUNT(*) as n FROM grn_request WHERE sub_head = ?', [junk]);
    const n = cnt[0].n;
    if (!n) continue;
    await hrms.execute("UPDATE grn_request SET sub_head = '', updated_at = NOW() WHERE sub_head = ?", [junk]);
    console.log(`  CLEARED ${n} rows: "${junk}" → ""`);
    totalChanged += n;
  }

  // ── Fix 4: Backfill vendor_expense_mapping from db_bill ──────────────────
  console.log('\n── Fix 4: Backfilling vendor_expense_mapping from db_bill ──');

  // Get the 614 unmapped active vendors with DB_BILL_ prefix
  const [unmapped] = await hrms.execute(`
    SELECT vm.id as hrms_id, vm.vendor_code, vm.vendor_name,
           CAST(REPLACE(vm.vendor_code, 'DB_BILL_', '') AS UNSIGNED) AS dbbill_id
      FROM vendor_master vm
     WHERE vm.is_active = 1
       AND vm.vendor_code LIKE 'DB_BILL_%'
       AND NOT EXISTS (
         SELECT 1 FROM vendor_expense_mapping vem
          WHERE vem.vendor_id = vm.id AND vem.active_status = 1
       )
  `);
  console.log(`  Found ${unmapped.length} unmapped DB_BILL vendors`);

  if (unmapped.length > 0) {
    const dbbill = await mysql.createConnection({ ...DBBILL, connectTimeout: 10000 });
    console.log('  ✓ Connected to db_bill');

    // Load db_bill head/subhead name lookup
    const [dbHeads] = await dbbill.execute('SELECT HeadingId, HeadingDesc FROM tbl_bgt_expenseheadingmaster');
    const [dbSubHeads] = await dbbill.execute('SELECT SubHeadingId, HeadingId, SubHeadingDesc FROM tbl_bgt_expensesubheadingmaster');

    const dbHeadMap = {};  // HeadingId -> HeadingDesc
    for (const r of dbHeads) dbHeadMap[String(r.HeadingId)] = String(r.HeadingDesc);
    const dbSubHeadMap = {};  // SubHeadingId -> SubHeadingDesc
    for (const r of dbSubHeads) dbSubHeadMap[String(r.SubHeadingId)] = String(r.SubHeadingDesc);

    // Load mas_hrms head/subhead lookup by name (case-insensitive)
    const [hrmsHeads] = await hrms.execute('SELECT id, head_code, head_name FROM finance_expense_head_master WHERE active_status = 1');
    const [hrmsSubHeads] = await hrms.execute('SELECT id, sub_head_code, sub_head_name, head_id FROM finance_expense_sub_head_master WHERE active_status = 1');

    const hrmsHeadByName = {};
    for (const r of hrmsHeads) hrmsHeadByName[r.head_name.trim().toLowerCase()] = r;
    const hrmsSubByName = {};
    for (const r of hrmsSubHeads) hrmsSubByName[r.sub_head_name.trim().toLowerCase()] = r;

    // Get db_bill vendor → head/subhead relations (for all dbbill IDs at once)
    const dbbillIds = unmapped.map(r => r.dbbill_id).filter(Boolean);
    let mappingsInserted = 0;
    let mappingsSkipped = 0;

    if (dbbillIds.length) {
      const placeholders = dbbillIds.map(() => '?').join(',');
      const [dbRelations] = await dbbill.execute(
        `SELECT VendorId, HeadId, SubHeadId FROM vendor_expense_relation WHERE VendorId IN (${placeholders})`,
        dbbillIds
      );

      // Index relations by VendorId
      const relByVendor = {};
      for (const r of dbRelations) {
        const vid = String(r.VendorId);
        if (!relByVendor[vid]) relByVendor[vid] = [];
        relByVendor[vid].push(r);
      }

      const createdById = '00000000-0000-0000-0000-000000000001'; // system

      for (const vendor of unmapped) {
        const relations = relByVendor[String(vendor.dbbill_id)] ?? [];
        if (!relations.length) {
          mappingsSkipped++;
          continue;
        }

        for (const rel of relations) {
          const headDesc = dbHeadMap[String(rel.HeadId)];
          const subDesc  = dbSubHeadMap[String(rel.SubHeadId)];
          if (!headDesc || !subDesc) continue;

          const hrmsHead = hrmsHeadByName[headDesc.trim().toLowerCase()];
          const hrmsSub  = hrmsSubByName[subDesc.trim().toLowerCase()];
          if (!hrmsHead) {
            console.log(`    WARN: no mas_hrms head for db_bill head "${headDesc}" (vendor: ${vendor.vendor_name})`);
            continue;
          }
          if (!hrmsSub) {
            console.log(`    WARN: no mas_hrms sub-head for db_bill sub "${subDesc}" (vendor: ${vendor.vendor_name})`);
            continue;
          }

          // Check if mapping already exists (idempotent)
          const [dup] = await hrms.execute(
            'SELECT 1 FROM vendor_expense_mapping WHERE vendor_id = ? AND head_code = ? AND sub_head_code = ? LIMIT 1',
            [vendor.hrms_id, hrmsHead.head_code, hrmsSub.sub_head_code]
          );
          if (dup.length) continue;

          const mapId = randomUUID();
          await hrms.execute(
            `INSERT INTO vendor_expense_mapping
               (id, vendor_id, head_id, head_code, sub_head_id, sub_head_code,
                active_status, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
            [mapId, vendor.hrms_id, hrmsHead.id, hrmsHead.head_code,
             hrmsSub.id, hrmsSub.sub_head_code, createdById]
          );
          rollback.push(`DELETE FROM vendor_expense_mapping WHERE id = '${mapId}';`);
          mappingsInserted++;
        }
      }
    }

    await dbbill.end();
    console.log(`  Inserted ${mappingsInserted} new vendor mappings, skipped ${mappingsSkipped} (no db_bill relation found)`);
    totalChanged += mappingsInserted;
  }

  await hrms.end();

  // ── Verification ─────────────────────────────────────────────────────────
  console.log('\n── Verification summary ──');
  console.log(`  Total rows changed / records inserted: ${totalChanged}`);
  console.log('\n── Rollback statements (reverse order) ──');
  for (const stmt of rollback.reverse()) console.log(' ', stmt);
  console.log('\n✅ Done.');
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
