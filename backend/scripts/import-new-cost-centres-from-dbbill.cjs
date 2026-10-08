/**
 * Bring cost centres created in db_bill.cost_master across into mas_hrms.cost_centre_master,
 * with the full field set - both the ones with no HRMS row at all and the ones sitting in
 * HRMS as an empty code-only shell.
 *
 * WHY THIS EXISTS
 * ---------------
 * scripts/sync-db-bill-snapshot.mjs (`--only=cost_centres`) enriches cost centres, but every
 * statement it runs is an `UPDATE ... WHERE cost_centre_code = ?`. A cost centre created in
 * db_bill after HRMS was seeded therefore matches nothing and is silently skipped - the sync
 * reports success while the new cost centre never appears in HRMS.
 *
 * Measured 2026-09-08, 13 cost centres created in db_bill since the last seed (ids 973-985)
 * had reached HRMS in two different broken states:
 *   - 4 (ids 982-985) had NO HRMS row at all. One of these is BSS/OB/Noida/1045
 *     (SATYA E-COM SERVICES LIMITED), created that morning.
 *   - 9 (ids 973-981) had an HRMS row carrying ONLY the code - client_name, bill_source_id
 *     and every billing field NULL, bill_snapshot_at NULL. Present enough to pick in a
 *     dropdown, empty enough to be useless for billing.
 * So "is it in HRMS" was the wrong question; "does the HRMS row carry the detail" is the
 * right one, and this script handles both cases.
 *
 * The sync also writes only ~25 of the ~90 columns, so the legacy-parity fields added by
 * migration 1510 (bill-to / ship-to addresses, HSN, revenue type, payment terms, JCC/GRN) are
 * NULL on all 937 existing rows. This script writes the FULL field set for the rows it
 * touches, and mirrors the client / SCM / finance contact blocks into cost_centre_contacts,
 * which the Cost Centre Management page already reads.
 *
 * NOT DERIVED, ON PURPOSE
 *   process_id  - cost centre cannot resolve process. cost_centre_master.process_id is
 *                 populated on 0 of 927 rows and process_name_bill (the billing campaign)
 *                 agrees with process_master only 2.9% of the time. A wrong process prints on
 *                 employment agreements; blank is the reviewed decision.
 *   client_id / lob_id - unpopulated on all 937 existing rows. Inventing a link here would
 *                 make these 13 rows the only ones shaped differently.
 *
 * SAFETY
 *   - dry run unless --apply;
 *   - INSERT where cost_centre_code has no row;
 *   - ENRICH only rows whose bill_snapshot_at IS NULL, i.e. rows the sync has never touched,
 *     and even then only columns that are currently NULL or ''. A value already in HRMS is
 *     never overwritten. That rule is what protects BSS/BLD/AHMH-JD/1041, whose
 *     cost_centre_name is the human-set display name "AVORE E-BIKE" restored by migration
 *     1247 - a blind field-for-field copy would have replaced it with the raw code and quietly
 *     undone that migration.
 *   - writes the plan to backend/backups/ before any write.
 *
 * Usage:
 *   node scripts/import-new-cost-centres-from-dbbill.cjs            # dry run
 *   node scripts/import-new-cost-centres-from-dbbill.cjs --apply    # writes
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

function envFile() {
  const p = path.resolve(__dirname, '..', '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const E = envFile();
const pick = (k, d) => process.env[k] || E[k] || d;

const HRMS_HOSTS = [pick('DB_HOST', '192.168.10.6'), '122.184.128.90'];
const BILL_HOSTS = [pick('BILL_DB_HOST', '192.168.10.22'), '14.97.30.236'];

async function connectAny(hosts, database, label) {
  for (const host of hosts) {
    try {
      const c = await mysql.createConnection({
        host, user: pick('DB_USER'), password: pick('DB_PASSWORD'), database, connectTimeout: 20000,
      });
      console.log(`  ${label}: connected via ${host}`);
      return c;
    } catch (e) { console.log(`  ${label}: ${host} -> ${e.code}`); }
  }
  throw new Error(`${label} unreachable on every known address`);
}

/** db_bill branch name -> mas_hrms.branch_master.id. Same table as sync-db-bill-snapshot.mjs. */
const BRANCH_MAP = {
  'AHMEDABAD HOUSE':           'fe9c9d14-6583-11f1-adb1-00155d0ab410',
  'AHMEDABAD OTHERS':          'fe9e502c-6583-11f1-adb1-00155d0ab410',
  'AHMEDABAD-JALDARSHAN':      'fea10538-6583-11f1-adb1-00155d0ab410',
  'AHMEDABAD-NEELAKANTH':      'fea2c991-6583-11f1-adb1-00155d0ab410',
  'DELHI':                     'fea43dc9-6583-11f1-adb1-00155d0ab410',
  'DEL OTHERS':                '774b3ded-5e88-11f1-adb1-00155d0ab410',
  'HEAD OFFICE':               'fea9fdc3-6583-11f1-adb1-00155d0ab410',
  'GENLEAP':                   'fea80658-6583-11f1-adb1-00155d0ab410',
  'HYDERABAD':                 '6a90bb9d-5caf-11f1-adb1-00155d0ab410',
  'JAIPUR':                    'fead2650-6583-11f1-adb1-00155d0ab410',
  'JAIPUR IDC':                'feae8bc7-6583-11f1-adb1-00155d0ab410',
  'KARNAL':                    'feb03b3a-6583-11f1-adb1-00155d0ab410',
  'MAS-SKILL DEVELOPMENT PROJECT': 'feb1fdad-6583-11f1-adb1-00155d0ab410',
  'MAYAPURI':                  'feb3ff2d-6583-11f1-adb1-00155d0ab410',
  'MEERUT':                    'feb79faa-6583-11f1-adb1-00155d0ab410',
  'MOHALI':                    'feb94bca-6583-11f1-adb1-00155d0ab410',
  'NOIDA':                     '77769026-5e88-11f1-adb1-00155d0ab410',
  'NOIDA ISPARK-2':            'febb909f-6583-11f1-adb1-00155d0ab410',
  'NOIDA-2':                   'febd8777-6583-11f1-adb1-00155d0ab410',
  'NOIDA-DIALDESK':            'febeee54-6583-11f1-adb1-00155d0ab410',
  'NOIDA-ISPARK':              'fec0d5da-6583-11f1-adb1-00155d0ab410',
  'PAYPIK':                    'fec24b2c-6583-11f1-adb1-00155d0ab410',
  'Vdf Manpower':              'fea5b34a-6583-11f1-adb1-00155d0ab410',
  'VDF MANPOWER':              'fea5b34a-6583-11f1-adb1-00155d0ab410',
};

// -- value coercion -----------------------------------------------------------
// db_bill columns are almost all varchar. `category` and `type` carry trailing newlines
// ("Voice\n"), and Yes/No/1/0 are used interchangeably for the same flag, so every value is
// normalised here rather than at each of the ~60 call sites.

const trim = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r?\n/g, ' ').trim();
  return s === '' ? null : s;
};
/** 'Yes'/'1'/'true' -> 1, everything else (including null) -> 0. */
const yn = (v) => {
  const s = trim(v);
  if (s === null) return 0;
  return /^(y|yes|1|true)$/i.test(s) ? 1 : 0;
};
const toInt = (v) => {
  const s = trim(v);
  if (s === null) return null;
  const n = parseInt(s.replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const toDec = (v) => {
  const s = trim(v);
  if (s === null) return null;
  const n = parseFloat(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
/**
 * MySQL 5.5 hands back '0000-00-00 00:00:00' as an Invalid Date rather than null, and
 * cost_master.close is a varchar that holds 'No' as often as it holds a date. Anything that
 * is not a real date becomes NULL - a bogus date on a billing record is worse than a blank.
 */
const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1990) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Full db_bill.cost_master -> mas_hrms.cost_centre_master field map.
 * Key = HRMS column, value = function of the db_bill row.
 */
const FIELD_MAP = {
  cost_centre_code:      r => trim(r.cost_center),
  // Every one of the 803 bill-sourced rows already in HRMS carries name = code. Keeping that
  // convention matters because display code and report groupings key off the pair being equal.
  cost_centre_name:      r => trim(r.cost_center),
  company_name:          r => trim(r.company_name),
  branch_id:             r => BRANCH_MAP[trim(r.branch)] ?? null,
  active_status:         r => (Number(r.active) === 1 ? 1 : 0),
  bill_source_id:        r => r.id,
  bill_source_branch:    r => trim(r.branch),
  client_name:           r => trim(r.client) ?? trim(r.process_name),
  billing_client_name:   r => trim(r.client_tally_name),
  tally_head:            r => trim(r.TallyHead),
  stream:                r => trim(r.stream),
  process_type:          r => trim(r.process),
  process_name_bill:     r => trim(r.process_name),
  cc_category:           r => trim(r.category),
  cc_type:               r => trim(r.type),
  tower:                 r => trim(r.tower),
  mandated_seats:        r => trim(r.total_man_date),
  mandated_seats_value:  r => toInt(r.total_man_date),
  shrinkage_pct:         r => trim(r.shrinkage),
  shrinkage_percentage:  r => toDec(r.shrinkage),
  attrition_pct:         r => trim(r.attrition),
  attrition_percentage:  r => toDec(r.attrition),
  shift_count:           r => trim(r.shift),
  shift_hours:           r => trim(r.shift),
  working_days_pw:       r => trim(r.working_days),
  working_days_per_week: r => toInt(r.working_days),
  training_days:         r => toInt(r.training_days),
  incentive_allowed:     r => yn(r.incentive_allowed),
  deduction_allowed:     r => yn(r.deduction_allowed),
  revenue_flag:          r => (Number(r.Revenue) === 1 ? 1 : 0),
  billing_flag:          r => (Number(r.Billing) === 1 ? 1 : 0),
  revenue_type:          r => trim(r.revenueType),
  fixed_amount:          r => toDec(r.fixed),
  variable_base:         r => trim(r.variableBase),
  payment_mode:          r => trim(r.paymentMode),
  payment_terms:         r => trim(r.paymentTerms),
  process_manager:       r => trim(r.process_manager),
  ops_email:             r => trim(r.emailid),
  hr_email:              r => trim(r.hremail),
  gst_type:              r => trim(r.GSTType),
  hsn_code:              r => trim(r.HSNCode),
  sac_code:              r => trim(r.SACCode),
  service_tax_no:        r => trim(r.ServiceTaxNo),
  vendor_gst_no:         r => trim(r.VendorGSTNo),
  vendor_gst_state:      r => trim(r.VendorGSTState),
  vendor_state_code:     r => trim(r.VendorStateCode),
  bill_to_address1:      r => trim(r.b_Address1),
  bill_to_address2:      r => trim(r.b_Address2),
  bill_to_address3:      r => trim(r.b_Address3),
  bill_to_address4:      r => trim(r.b_Address4),
  bill_to_address5:      r => trim(r.b_Address5),
  ship_to_address1:      r => trim(r.a_address1),
  ship_to_address2:      r => trim(r.a_address2),
  ship_to_address3:      r => trim(r.a_address3),
  ship_to_address4:      r => trim(r.a_address4),
  ship_to_address5:      r => trim(r.a_address5),
  association_date:      r => toDate(r.AssociationDate),
  go_live_date:          r => toDate(r.goLiveDate),
  close_date:            r => toDate(r.close),
  group_cost_center:     r => trim(r.group_cost_center),
  cost_center_type:      r => trim(r.cost_center_type),
  dialdee_type:          r => trim(r.dialdee_type) ?? 'shared',
  jcc_no:                r => trim(r.jcc_no),
  grn:                   r => trim(r.grn),
  po_required:           r => yn(r.po_required),
  // db_bill runs a two-level approval (approve1 / approve2). A cost centre that cleared both
  // and is still active is 'active' in HRMS; anything else lands as 'draft' so it surfaces in
  // the approval queue rather than going live unreviewed.
  status: r => (Number(r.approve1) === 1 && Number(r.approve2) === 1 && Number(r.active) === 1)
    ? 'active' : 'draft',
};

/** The three contact blocks db_bill stores as numbered columns. */
const CONTACT_BLOCKS = [
  { type: 'client',  name: 'UserName',    desig: 'UserDesignation',    phone: 'UserContactNo',    email: 'UserEmailId' },
  { type: 'scm',     name: 'SCMName',     desig: 'SCMDesignation',     phone: 'SCMContactNo',     email: 'SCMEmailId' },
  { type: 'finance', name: 'FinanceName', desig: 'FinanceDesignation', phone: 'FinanceContactNo', email: 'FinanceEmailId' },
];

(async () => {
  console.log(APPLY ? '=== APPLY MODE - this will write ===' : '=== DRY RUN - no writes ===');
  const hrms = await connectAny(HRMS_HOSTS, pick('DB_NAME', 'mas_hrms'), 'mas_hrms');
  const bill = await connectAny(BILL_HOSTS, pick('BILL_DB_NAME', 'db_bill'), 'db_bill');

  /** A column counts as empty - and so is safe to fill - only when NULL or blank. */
  const isEmpty = (v) => v === null || v === undefined || String(v).trim() === '';

  try {
    const [billRows] = await bill.query(
      `SELECT * FROM cost_master WHERE cost_center IS NOT NULL AND cost_center != '' ORDER BY id`
    );
    const cols = Object.keys(FIELD_MAP);
    // Pull the full HRMS row, not just the code: enrichment has to know which columns already
    // carry a value so it can leave them alone.
    const [hrmsRows] = await hrms.query(
      `SELECT id, bill_snapshot_at, ${cols.join(', ')} FROM cost_centre_master`
    );
    const byCode = new Map(hrmsRows.map(r => [String(r.cost_centre_code).trim().toUpperCase(), r]));

    const toInsert = [];
    const toEnrich = [];

    for (const row of billRows) {
      const code = String(row.cost_center).trim();
      const existing = byCode.get(code.toUpperCase());
      const byCol = Object.fromEntries(cols.map(c => [c, FIELD_MAP[c](row)]));

      const contacts = [];
      for (const b of CONTACT_BLOCKS) {
        for (let i = 1; i <= 3; i++) {
          const name = trim(row[`${b.name}${i}`]);
          const email = trim(row[`${b.email}${i}`]);
          const phone = trim(row[`${b.phone}${i}`]);
          const desig = trim(row[`${b.desig}${i}`]);
          if (!name && !email && !phone) continue;
          contacts.push({ type: b.type, seq: i, name, email, phone, desig, primary: i === 1 ? 1 : 0 });
        }
      }

      const base = {
        billId: row.id, code, client: byCol.client_name, branch: byCol.bill_source_branch,
        branchMapped: Boolean(byCol.branch_id), status: byCol.status, byCol, contactRows: contacts,
      };

      if (!existing) { toInsert.push(base); continue; }

      // Only rows the sync has never reached are candidates for enrichment. Once
      // bill_snapshot_at is set the sync owns those columns and re-deciding them here would
      // put two writers on the same fields.
      if (existing.bill_snapshot_at !== null) continue;

      // Fill only what is empty. cost_centre_name is the field this matters most for:
      // BSS/BLD/AHMH-JD/1041 already reads "AVORE E-BIKE" and must keep it.
      const fill = cols.filter(c => !isEmpty(byCol[c]) && isEmpty(existing[c]));
      if (fill.length === 0) continue;
      toEnrich.push({ ...base, hrmsId: existing.id, fill });
    }

    console.log(`\ndb_bill cost centres:            ${billRows.length}`);
    console.log(`missing from HRMS (INSERT):      ${toInsert.length}`);
    console.log(`code-only shells in HRMS (FILL): ${toEnrich.length}\n`);

    const line = (p, verb, extra) =>
      `  ${verb} [${String(p.billId).padStart(3)}] ${p.code.padEnd(26)} ` +
      `${String(p.client ?? '-').slice(0, 38).padEnd(40)} ` +
      `${String(p.branch ?? '-').padEnd(22)} ` +
      `${p.branchMapped ? 'branch OK      ' : 'BRANCH UNMAPPED'}  ${extra}`;

    for (const p of toInsert) {
      console.log(line(p, 'INSERT', `${String(p.status).padEnd(6)} ` +
        `${cols.filter(c => p.byCol[c] !== null).length}/${cols.length} fields  ${p.contactRows.length} contacts`));
    }
    for (const p of toEnrich) {
      console.log(line(p, 'FILL  ', `${p.fill.length} empty fields  ${p.contactRows.length} contacts`));
    }

    const unmapped = [...toInsert, ...toEnrich].filter(p => !p.branchMapped);
    if (unmapped.length) {
      console.log(`\n  WARNING: ${unmapped.length} row(s) have a db_bill branch with no branch_master match:`);
      for (const u of unmapped) console.log(`    ${u.code} -> "${u.branch}"`);
      console.log('  These land with branch_id NULL and will not appear in any branch-scoped view.');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.resolve(__dirname, '..', 'backups');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `cost-centre-import-plan-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ toInsert, toEnrich }, null, 2));
    console.log(`\nPlan written to ${outFile}`);

    if (!APPLY) {
      console.log('\nDRY RUN - nothing written. Re-run with --apply to import.');
      return;
    }

    /** Contacts are keyed by (cost centre, type, sequence); re-running must not duplicate. */
    async function writeContacts(costCentreId, contactRows) {
      let n = 0;
      for (const c of contactRows) {
        const [dup] = await hrms.execute(
          `SELECT id FROM cost_centre_contacts
            WHERE cost_centre_id = ? AND contact_type = ? AND contact_sequence = ? LIMIT 1`,
          [costCentreId, c.type, c.seq]
        );
        if (dup.length) continue;
        await hrms.execute(
          `INSERT INTO cost_centre_contacts
             (id, cost_centre_id, contact_type, contact_sequence, contact_name, contact_email,
              contact_phone, contact_designation, is_primary, created_at, updated_at)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [costCentreId, c.type, c.seq, c.name, c.email, c.phone, c.desig, c.primary]
        );
        n++;
      }
      return n;
    }

    let inserted = 0, enriched = 0, contactsInserted = 0;

    for (const p of toInsert) {
      const insertCols = ['id', ...cols, 'bill_snapshot_at', 'created_at', 'updated_at'];
      const placeholders = ['UUID()', ...cols.map(() => '?'), 'NOW()', 'NOW()', 'NOW()'];
      await hrms.execute(
        `INSERT INTO cost_centre_master (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        cols.map(c => p.byCol[c])
      );
      const [[created]] = await hrms.query(
        `SELECT id FROM cost_centre_master WHERE cost_centre_code = ? LIMIT 1`, [p.code]
      );
      inserted++;
      const n = await writeContacts(created.id, p.contactRows);
      contactsInserted += n;
      console.log(`  inserted ${p.code} (${created.id}) + ${n} contacts`);
    }

    for (const p of toEnrich) {
      await hrms.execute(
        `UPDATE cost_centre_master SET ${p.fill.map(c => `${c} = ?`).join(', ')},
                bill_snapshot_at = NOW(), updated_at = NOW()
          WHERE id = ?`,
        [...p.fill.map(c => p.byCol[c]), p.hrmsId]
      );
      enriched++;
      const n = await writeContacts(p.hrmsId, p.contactRows);
      contactsInserted += n;
      console.log(`  filled   ${p.code} (${p.hrmsId}) - ${p.fill.length} fields + ${n} contacts`);
    }

    console.log(`\nDone. Inserted: ${inserted}. Enriched: ${enriched}. Contacts: ${contactsInserted}.`);
  } finally {
    await hrms.end(); await bill.end();
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
