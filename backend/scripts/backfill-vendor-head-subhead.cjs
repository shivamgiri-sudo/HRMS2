/**
 * backfill-vendor-head-subhead.cjs
 *
 * Fills vendor_expense_mapping in mas_hrms for every active DB_BILL_* vendor
 * that currently has no mapping, using db_bill.vendor_master HeadId/SubHeadId
 * decoded via a hard-coded cross-reference table.
 *
 * Run (dry-run first, then live):
 *   node backend/scripts/backfill-vendor-head-subhead.cjs --dry-run
 *   node backend/scripts/backfill-vendor-head-subhead.cjs
 *
 * GAPS (not touched by this script — need manual mapping in the UI):
 *   HeadId=000003 / SubHeadId=000010  Finance Expenses / Interest Charges  (6 vendors)
 *   HeadId=000009 / SubHeadId=000080  Outsourcing / Software Development   (3 vendors)
 *   HeadId=000006 / SubHeadId=000000  Contract Fees-Others / NULL           (4 vendors)
 *   HeadId=000011 / SubHeadId=NULL    Repair & Maintenance / NULL           (1 vendor)
 */

'use strict';
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Cross-reference: db_bill (HeadId:SubHeadId) → mas_hrms (head_code:sub_head_code) ──
// Data-error cases are included with a comment explaining the correction applied.
const MAPPING = [
  // Communication & Connectivity
  ['000001','000003','COMMUNICATION_CONNECTIVITY','COMPANY_VOICE'],
  ['000001','000004','COMMUNICATION_CONNECTIVITY','COMPANY_DATA'],
  ['000001','000005','COMMUNICATION_CONNECTIVITY','MOBILE_INTERNET_REIMBURSEMENT'],
  ['000001','000025','COMMUNICATION_CONNECTIVITY','POSTAGE_COURIER'],
  ['000001','000066','COMMUNICATION_CONNECTIVITY','SMS_CHARGES'],
  ['000001','000068','COMMUNICATION_CONNECTIVITY','COMPANY_VOICE_REIMBURSEMENT'],
  // Electricity
  ['000002','000007','ELECTRICITY','ELECTRICITY_GOVT'],
  ['000002','000008','ELECTRICITY','GENERATOR_DIESEL'],   // PO variant
  ['000002','000050','ELECTRICITY','GENERATOR_DIESEL'],
  ['000002','000012','ELECTRICITY','GENERATOR_DIESEL'],   // data-err: subhead 000012 belongs to head 000004; vendor is clearly a generator supplier
  // Hiring Charges
  ['000004','000012','HIRING_CHARGES','GENERATOR_HIRE'],
  ['000004','000051','HIRING_CHARGES','COMPUTER_HIRE'],
  ['000004','000061','HIRING_CHARGES','AC_HIRE'],
  ['000004','000062','HIRING_CHARGES','AC_HIRE'],          // data-err: subhead 000062 cross-head; AC hire intent clear
  ['000004','000063','HIRING_CHARGES','UPS_HIRE'],
  // Office Rent
  ['000005','000013','OFFICE_RENT','OFFICE_RENT'],
  // Contract Fees
  ['000006','000056','CONTRACT_FEES_FACILITIES','FACILITY_STAFF'],
  // Miscellaneous Expenses — each subhead maps to a different mas_hrms head
  ['000007','000017','LEGAL_CONSULTANCY','LEGAL_PROFESSIONAL'],
  ['000007','000018','INSURANCE_EXPENSES','INFRA_INSURANCE'],
  ['000007','000078','FEE_SUBSCRIPTION','FEE_SUBSCRIPTION'],
  ['000007','000089','FREIGHT_CARGO','FREIGHT_CARGO'],
  // Office Maintenance
  ['000008','000019','OFFICE_MAINTENANCE','WATER_TANKER'],
  ['000008','000020','OFFICE_MAINTENANCE','CAFETERIA_MAINTENANCE'],
  ['000008','000021','OFFICE_MAINTENANCE','CLEANING_MATERIAL'],
  // Outsourcing Exp
  ['000009','000022','SECURITY_SERVICE','SECURITY_SERVICE'],
  ['000009','000024','CONTRACT_FEES','PROCESS_OUTSOURCING'],
  // Printing & Stationery
  ['000010','000026','PRINTING_STATIONERY','OFFICE_STATIONERY'],
  ['000010','000027','PRINTING_STATIONERY','OFFICE_STATIONERY'],
  // Repair & Maintenance — OPEX
  ['000011','000030','REPAIRS_MAINTENANCE','COMPUTER_PERIPHERALS'],
  ['000011','000031','REPAIRS_MAINTENANCE','COMPUTER_PERIPHERALS'],
  ['000011','000058','REPAIRS_MAINTENANCE','UPS_NETWORKING'],
  ['000011','000062','REPAIRS_MAINTENANCE','AC_REPAIRS'],
  ['000011','000081','REPAIRS_MAINTENANCE','ELECTRICAL_REPAIRS'],
  ['000011','000082','REPAIRS_MAINTENANCE','FURNITURE_FIXTURES_REPAIR'],
  ['000011','000083','REPAIRS_MAINTENANCE','OFFICE_REPAIRS'],
  ['000011','000084','REPAIRS_MAINTENANCE','COMPUTER_PERIPHERALS'],
  ['000011','000085','REPAIRS_MAINTENANCE','VEHICLE_REPAIR'],
  ['000011','000086','REPAIRS_MAINTENANCE','SERVICE_MAINTENANCE'],
  // Repair & Maintenance — CAPEX (installation/fitting)
  ['000011','000032','REPAIRS_MAINTENANCE_CAPEX','CAPEX_ELECTRICAL'],
  ['000011','000033','REPAIRS_MAINTENANCE_CAPEX','CAPEX_ELECTRICAL'],
  ['000011','000034','REPAIRS_MAINTENANCE_CAPEX','CAPEX_FURNITURE_FIXTURE'],
  ['000011','000035','REPAIRS_MAINTENANCE_CAPEX','CAPEX_FURNITURE_FIXTURE'],
  ['000011','000060','REPAIRS_MAINTENANCE_CAPEX','CAPEX_AIR_CONDITIONING'],
  // Staff Training & Recruitment
  ['000012','000038','STAFF_TRAINING_RECRUITMENT','RECRUITMENT_ADVERTISEMENT'],
  ['000012','000039','STAFF_TRAINING_RECRUITMENT','RECRUITMENT_ADVERTISEMENT'],
  ['000012','000045','STAFF_WELFARE','REFRESHMENT'],  // Tea & Coffee misfiled under training
  // Staff Welfare
  ['000013','000040','STAFF_WELFARE','DRINKING_WATER'],
  ['000013','000041','STAFF_WELFARE','RNR_EXPENSES'],
  ['000013','000042','STAFF_WELFARE','FESTIVAL_EXPENSE'],
  ['000013','000043','BUSINESS_PROMOTION','BUSINESS_PROMOTION'],
  ['000013','000044','STAFF_WELFARE','REFRESHMENT'],
  ['000013','000045','STAFF_WELFARE','REFRESHMENT'],
  ['000013','000052','STAFF_WELFARE','RNR_EXPENSES'],
  ['000013','000053','STAFF_WELFARE','DRINKING_WATER'],
  // Travelling
  ['000014','000046','TOURS_TRAVELLING_CONVEYANCE','LOCAL_CONVEYANCE'],
  ['000014','000047','TOURS_TRAVELLING_CONVEYANCE','LOCAL_CONVEYANCE'],
  ['000014','000049','TOUR_EXPENSES','TOUR_EXPENSES'],
  // Others
  ['000015','000054','OTHERS','DONATION_OTHERS'],
  ['000015','000069','OTHERS','CAPEX_OTHERS'],
  ['000015','000016','OTHERS','DONATION_OTHERS'],   // data-err: subhead 000016 (Donation) belongs to head 000006; donation intent correct
  // Contract Fees Facilities (head 000016)
  ['000016','000070','CONTRACT_FEES_FACILITIES','FACILITY_STAFF'],
  // Security
  ['000018','000072','SECURITY_SERVICE','SECURITY_SERVICE'],
  // Insurance
  ['000019','000074','INSURANCE_EXPENSES','INFRA_INSURANCE'],
  // Legal / Consultancy
  ['000020','000076','LEGAL_CONSULTANCY','BROKERAGE_CONSULTANCY'],
  ['000020','000077','LEGAL_CONSULTANCY','LEGAL_PROFESSIONAL'],
  // Sales / Business Promotion
  ['000021','000091','BUSINESS_PROMOTION','BUSINESS_PROMOTION'],
];

// Build a quick lookup: "headId|subId" → [hrms_head_code, hrms_sub_code]
const LOOKUP = new Map(MAPPING.map(([h, s, hc, sc]) => [`${h}|${s}`, [hc, sc]]));

// Skipped combos (for reporting)
const SKIP_REASONS = {
  '000003|000010': 'NO_MATCH: Finance Expenses/Interest Charges — no matching head in mas_hrms (6 vendors)',
  '000009|000080': 'NO_MATCH: Software Development Charges — no matching subhead in mas_hrms (3 vendors)',
  '000006|000000': 'AMBIGUOUS: Contract Fees-Others / NULL subhead — cannot determine correct subhead (4 vendors)',
  '000011|':       'AMBIGUOUS: Repair & Maintenance / NULL subhead (1 vendor)',
};

async function main() {
  const billCfg = {
    host: process.env.BILL_DB_HOST || '192.168.10.22',
    port: Number(process.env.BILL_DB_PORT || 3306),
    user: process.env.BILL_DB_USER || 'shivam_user',
    password: process.env.BILL_DB_PASSWORD || 'qwersdfg!@#hjk',
    database: process.env.BILL_DB_NAME || 'db_bill',
  };
  const hrmsCfg = {
    host: process.env.DB_HOST || '192.168.10.6',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'shivam_user',
    password: process.env.DB_PASSWORD || 'qwersdfg!@#hjk',
    database: process.env.DB_NAME || 'mas_hrms',
  };

  const bill = await mysql.createConnection(billCfg);
  const hrms = await mysql.createConnection(hrmsCfg);
  console.log(DRY_RUN ? '[DRY RUN] Connected to both DBs' : 'Connected to both DBs');

  // 1. Get all active db_bill vendors with head/subhead
  const [billVendors] = await bill.query(
    `SELECT Id, vendor, HeadId, COALESCE(SubHeadId,'') AS SubHeadId
     FROM vendor_master WHERE active = 1`,
  );

  // 2. Get unmapped vendor IDs in mas_hrms
  const [unmapped] = await hrms.query(
    `SELECT v.id AS hrms_id, CAST(SUBSTRING(v.vendor_code, 9) AS UNSIGNED) AS bill_id
     FROM vendor_master v
     WHERE v.is_active = 1
       AND v.vendor_code LIKE 'DB_BILL_%'
       AND NOT EXISTS (
         SELECT 1 FROM vendor_expense_mapping m
         WHERE m.vendor_id = v.id AND m.active_status = 1
       )`,
  );
  const unmappedByBillId = new Map(unmapped.map((r) => [r.bill_id, r.hrms_id]));

  // 3. Load mas_hrms head/subhead UUID lookup
  const [heads] = await hrms.query(
    `SELECT h.id AS head_id, h.head_code, s.id AS sub_id, s.sub_head_code
     FROM finance_expense_head_master h
     JOIN finance_expense_sub_head_master s ON s.head_id = h.id AND s.active_status = 1
     WHERE h.active_status = 1`,
  );
  const subLookup = new Map(
    heads.map((r) => [`${r.head_code}|${r.sub_head_code}`, { head_id: r.head_id, sub_id: r.sub_id }]),
  );

  // 4. Process
  let inserted = 0, skipped = 0, noMatch = 0, alreadyMapped = 0;
  const gapReport = [];

  const billById = new Map(billVendors.map((v) => [v.Id, v]));

  for (const [billId, hrmsId] of unmappedByBillId) {
    const bv = billById.get(billId);
    if (!bv) { gapReport.push({ billId, reason: 'NOT_IN_DB_BILL_ACTIVE' }); noMatch++; continue; }

    const key = `${bv.HeadId || ''}|${bv.SubHeadId || ''}`;
    const skipReason = SKIP_REASONS[key] || SKIP_REASONS[`${bv.HeadId}|`];
    if (skipReason) {
      gapReport.push({ billId, vendor: bv.vendor, key, reason: skipReason });
      skipped++;
      continue;
    }

    const hrmsTarget = LOOKUP.get(key);
    if (!hrmsTarget) {
      gapReport.push({ billId, vendor: bv.vendor, key, reason: `UNMAPPED_COMBO: ${key}` });
      noMatch++;
      continue;
    }

    const [hrmsHeadCode, hrmsSubCode] = hrmsTarget;
    const subEntry = subLookup.get(`${hrmsHeadCode}|${hrmsSubCode}`);
    if (!subEntry) {
      gapReport.push({ billId, vendor: bv.vendor, key, reason: `HRMS_SUBHEAD_NOT_FOUND: ${hrmsHeadCode}:${hrmsSubCode}` });
      noMatch++;
      continue;
    }

    if (!DRY_RUN) {
      await hrms.query(
        `INSERT INTO vendor_expense_mapping
           (id, vendor_id, head_id, head_code, sub_head_id, sub_head_code,
            active_status, effective_from, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, CURDATE(),
                 '00000000-0000-0000-0000-000000000001', NOW(), NOW())`,
        [randomUUID(), hrmsId, subEntry.head_id, hrmsHeadCode, subEntry.sub_id, hrmsSubCode],
      );
    } else {
      console.log(`  WOULD INSERT: DB_BILL_${billId} "${bv.vendor}" → ${hrmsHeadCode}:${hrmsSubCode}`);
    }
    inserted++;
  }

  console.log('\n════════════════ SUMMARY ════════════════');
  console.log(`Total unmapped vendors in mas_hrms:  ${unmappedByBillId.size}`);
  console.log(`Inserted (or would insert):          ${inserted}`);
  console.log(`Skipped (ambiguous / no match):      ${skipped}`);
  console.log(`No match / unexpected:               ${noMatch}`);
  console.log(`Already mapped (control check):      ${alreadyMapped}`);

  if (gapReport.length) {
    console.log('\n════════════════ GAPS — NEED MANUAL MAPPING ════════════════');
    const grouped = {};
    for (const g of gapReport) {
      grouped[g.reason] = grouped[g.reason] || [];
      grouped[g.reason].push(`  DB_BILL_${g.billId}${g.vendor ? ' "' + g.vendor + '"' : ''}`);
    }
    for (const [reason, vendors] of Object.entries(grouped)) {
      console.log(`\n${reason}`);
      vendors.forEach((v) => console.log(v));
    }
  }

  await bill.end();
  await hrms.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
