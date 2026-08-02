/**
 * sync-db-bill-snapshot.mjs
 *
 * Reads from db_bill (read-only) and populates snapshot tables in mas_hrms.
 * Safe to re-run — uses INSERT ... ON DUPLICATE KEY UPDATE throughout.
 * Never writes back to db_bill.
 *
 * Usage:
 *   node backend/scripts/sync-db-bill-snapshot.mjs
 *   node backend/scripts/sync-db-bill-snapshot.mjs --only=cost_centres
 *   node backend/scripts/sync-db-bill-snapshot.mjs --only=clients
 *   node backend/scripts/sync-db-bill-snapshot.mjs --only=provision
 *   node backend/scripts/sync-db-bill-snapshot.mjs --only=invoices
 */

import mysql from 'mysql2/promise';

// ── config ────────────────────────────────────────────────────────────────────

const HRMS = {
  host: '192.168.10.6', port: 3306,
  user: 'shivam_user', password: process.env.DB_PASSWORD,
  database: 'mas_hrms', connectTimeout: 20000, multipleStatements: false,
};

const BILL = {
  host: '192.168.10.22', port: 3306,
  user: 'shivam_user', password: process.env.DB_PASSWORD,
  database: 'db_bill', connectTimeout: 20000,
  dateStrings: true,  // prevents mysql2 from throwing on 0000-00-00 dates
};

// db_bill branch_name → mas_hrms branch_master.id
const BRANCH_MAP = {
  'AHMEDABAD HOUSE':           'fe9c9d14-6583-11f1-adb1-00155d0ab410',  // AHMH
  'AHMEDABAD OTHERS':          'fe9e502c-6583-11f1-adb1-00155d0ab410',  // AHMHO
  'AHMEDABAD-JALDARSHAN':      'fea10538-6583-11f1-adb1-00155d0ab410',  // AHMH-JD
  'AHMEDABAD-NEELAKANTH':      'fea2c991-6583-11f1-adb1-00155d0ab410',  // AHMEDABAD-NEELAKANTH
  'DELHI':                     'fea43dc9-6583-11f1-adb1-00155d0ab410',  // 07 / DELHI
  'DEL OTHERS':                '774b3ded-5e88-11f1-adb1-00155d0ab410',  // DEL_OTHERS
  'HEAD OFFICE':               'fea9fdc3-6583-11f1-adb1-00155d0ab410',  // CORP
  'GENLEAP':                   'fea80658-6583-11f1-adb1-00155d0ab410',  // 09 / GENLEAP
  'HYDERABAD':                 '6a90bb9d-5caf-11f1-adb1-00155d0ab410',  // HYD
  'JAIPUR':                    'fead2650-6583-11f1-adb1-00155d0ab410',  // JPR
  'JAIPUR IDC':                'feae8bc7-6583-11f1-adb1-00155d0ab410',  // JAID
  'KARNAL':                    'feb03b3a-6583-11f1-adb1-00155d0ab410',  // KNL
  'MAS-SKILL DEVELOPMENT PROJECT': 'feb1fdad-6583-11f1-adb1-00155d0ab410',
  'MAYAPURI':                  'feb3ff2d-6583-11f1-adb1-00155d0ab410',  // QUAL
  'MEERUT':                    'feb79faa-6583-11f1-adb1-00155d0ab410',  // MRT
  'MOHALI':                    'feb94bca-6583-11f1-adb1-00155d0ab410',  // CHD
  'NOIDA':                     '77769026-5e88-11f1-adb1-00155d0ab410',  // NOIDA
  'NOIDA ISPARK-2':            'febb909f-6583-11f1-adb1-00155d0ab410',
  'NOIDA-2':                   'febd8777-6583-11f1-adb1-00155d0ab410',  // NOIDA-2
  'NOIDA-DIALDESK':            'febeee54-6583-11f1-adb1-00155d0ab410',  // NOIDA-DD
  'NOIDA-ISPARK':              'fec0d5da-6583-11f1-adb1-00155d0ab410',  // NOI_ISPARK
  'PAYPIK':                    'fec24b2c-6583-11f1-adb1-00155d0ab410',
  'Vdf Manpower':              'fea5b34a-6583-11f1-adb1-00155d0ab410',  // DEL / VDF MANPOWER
  'VDF MANPOWER':              'fea5b34a-6583-11f1-adb1-00155d0ab410',
  'Lucknow':                   null,  // not in branch_master yet
};

// ── helpers ───────────────────────────────────────────────────────────────────

const BATCH = 500;

function safeInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function safeDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const s = v.toISOString().slice(0, 10);
    return s === '0000-00-00' ? null : s;
  }
  const s = String(v).trim().slice(0, 10);
  return (s === '0000-00-00' || s === '') ? null : s;
}

function trim(v) {
  return v ? String(v).trim() || null : null;
}

function log(msg) {
  process.stdout.write('[' + new Date().toISOString().slice(11, 19) + '] ' + msg + '\n');
}

async function insertBatch(hrms, table, rows, keys, updateCols) {
  if (!rows.length) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk.map(() => '(' + keys.map(() => '?').join(',') + ')').join(',');
    const values = chunk.flatMap(r => keys.map(k => r[k]));
    const updateClause = updateCols.map(c => `${c}=VALUES(${c})`).join(',');
    await hrms.query(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updateClause}`,
      values
    );
    inserted += chunk.length;
  }
  return inserted;
}

// ── Sync 1: cost_centre_master enrichment ─────────────────────────────────────

async function syncCostCentres(hrms, bill) {
  log('Sync 1: enriching cost_centre_master from db_bill.cost_master ...');

  const [billRows] = await bill.query(
    'SELECT id, cost_center, branch, stream, process, process_name, TallyHead, ' +
    'category, type, tower, total_man_date, shrinkage, attrition, shift, working_days, ' +
    'process_manager, emailid, hremail, GSTType, SACCode, VendorGSTNo, VendorGSTState, ' +
    'goLiveDate, close, active FROM cost_master WHERE cost_center IS NOT NULL AND cost_center != ""'
  );

  log('  db_bill.cost_master rows: ' + billRows.length);

  let updated = 0, skipped = 0;
  for (const row of billRows) {
    const cc = trim(row.cost_center);
    if (!cc) { skipped++; continue; }

    const branchId = BRANCH_MAP[trim(row.branch)] ?? null;

    await hrms.query(
      `UPDATE cost_centre_master SET
        bill_source_id     = ?,
        client_name        = ?,
        tally_head         = ?,
        stream             = ?,
        process_type       = ?,
        process_name_bill  = ?,
        cc_category        = ?,
        cc_type            = ?,
        tower              = ?,
        mandated_seats     = ?,
        shrinkage_pct      = ?,
        attrition_pct      = ?,
        shift_count        = ?,
        working_days_pw    = ?,
        process_manager    = ?,
        ops_email          = ?,
        hr_email           = ?,
        gst_type           = ?,
        sac_code           = ?,
        vendor_gst_no      = ?,
        vendor_gst_state   = ?,
        go_live_date       = ?,
        close_date         = ?,
        bill_source_branch = ?,
        bill_snapshot_at   = NOW(),
        active_status      = ?,
        branch_id          = COALESCE(branch_id, ?)
       WHERE cost_centre_code = ?`,
      [
        row.id,
        trim(row.client || row.process_name),
        trim(row.TallyHead),
        trim(row.stream),
        trim(row.process),
        trim(row.process_name),
        trim(row.category),
        trim(row.type),
        trim(row.tower),
        trim(row.total_man_date),
        trim(row.shrinkage),
        trim(row.attrition),
        trim(row.shift),
        trim(row.working_days),
        trim(row.process_manager),
        trim(row.emailid),
        trim(row.hremail),
        trim(row.GSTType),
        trim(row.SACCode),
        trim(row.VendorGSTNo),
        trim(row.VendorGSTState),
        safeDate(row.goLiveDate),
        row.close ? safeDate(row.close) : null,
        trim(row.branch),
        row.active === 1 ? 1 : 0,
        branchId,
        cc,
      ]
    );
    updated++;
  }
  log('  Updated: ' + updated + '  Skipped (no code): ' + skipped);

  // Report how many cost_centre_master rows still have no bill_source_id
  const [[{ unmatched }]] = await hrms.query(
    'SELECT COUNT(*) as unmatched FROM cost_centre_master WHERE bill_source_id IS NULL'
  );
  log('  cost_centre_master rows with no bill match: ' + unmatched);
}

// ── Sync 2: bill_client_snapshot ──────────────────────────────────────────────

async function syncClients(hrms, bill) {
  log('Sync 2: populating bill_client_snapshot from db_bill.client_master ...');

  const [billRows] = await bill.query(
    'SELECT id, client_type, client_name, branch_name, client_status FROM client_master'
  );
  log('  db_bill.client_master rows: ' + billRows.length);

  const rows = billRows.map(r => ({
    bill_source_id: r.id,
    client_type:    trim(r.client_type),
    client_name:    trim(r.client_name) || '(unknown)',
    branch_name:    trim(r.branch_name),
    client_status:  r.client_status === 1 ? 1 : 0,
    synced_at:      new Date(),
  }));

  const n = await insertBatch(hrms, 'bill_client_snapshot',
    rows,
    ['bill_source_id','client_type','client_name','branch_name','client_status','synced_at'],
    ['client_type','client_name','branch_name','client_status','synced_at']
  );
  log('  Upserted: ' + n);
}

// ── Sync 3: billing_provision_snapshot ────────────────────────────────────────

async function syncProvision(hrms, bill) {
  log('Sync 3: populating billing_provision_snapshot from db_bill.provision_master ...');

  // join with cost_master to get client + stream for denormalisation
  const [billRows] = await bill.query(
    `SELECT p.id, p.cost_center, p.branch_name, p.finance_year, p.month,
            p.invoiceType1, p.provision, p.billing_amt, p.billing_status,
            p.revenue_active, p.agreement, p.acknowledgment, p.remarks,
            c.client AS cm_client, c.stream AS cm_stream
     FROM provision_master p
     LEFT JOIN cost_master c ON c.cost_center = p.cost_center
     ORDER BY p.id`
  );
  log('  db_bill.provision_master rows: ' + billRows.length);

  const rows = billRows.map(r => ({
    bill_source_id:   r.id,
    cost_centre_code: trim(r.cost_center) || '',
    finance_year:     trim(r.finance_year) || '',
    month_label:      trim(r.month) || '',
    invoice_type:     trim(r.invoiceType1),
    provision_amt:    safeInt(r.provision),
    billing_amt:      safeInt(r.billing_amt),
    billing_status:   r.billing_status === 1 ? 1 : 0,
    revenue_active:   r.revenue_active === 1 ? 1 : 0,
    agreement:        trim(r.agreement),
    acknowledgment:   trim(r.acknowledgment),
    remarks:          trim(r.remarks),
    bill_client_name: trim(r.cm_client),
    bill_stream:      trim(r.cm_stream),
    bill_branch:      trim(r.branch_name),
    synced_at:        new Date(),
  }));

  const n = await insertBatch(hrms, 'billing_provision_snapshot',
    rows,
    ['bill_source_id','cost_centre_code','finance_year','month_label','invoice_type',
     'provision_amt','billing_amt','billing_status','revenue_active',
     'agreement','acknowledgment','remarks','bill_client_name','bill_stream','bill_branch','synced_at'],
    ['cost_centre_code','finance_year','month_label','invoice_type',
     'provision_amt','billing_amt','billing_status','revenue_active',
     'agreement','acknowledgment','remarks','bill_client_name','bill_stream','bill_branch','synced_at']
  );
  log('  Upserted: ' + n);
}

// ── Sync 4: billing_invoice_snapshot ─────────────────────────────────────────

async function syncInvoices(hrms, bill) {
  log('Sync 4: populating billing_invoice_snapshot from db_bill.tbl_invoice ...');

  const [billRows] = await bill.query(
    `SELECT id, invoiceType, category, branch_name, cost_center, finance_year, month,
            invoiceDate, bill_no, po_no, grn,
            total, tax, igst, sgst, cgst, grnd,
            GSTType, status, PaymentStatus, ReceiptStatus,
            cost_client, cost_stream, cost_process_name,
            bill_finance_year, carry_forward
     FROM tbl_invoice
     ORDER BY id`
  );
  log('  db_bill.tbl_invoice rows: ' + billRows.length);

  const rows = billRows.map(r => ({
    bill_source_id:   r.id,
    invoice_type:     trim(r.invoiceType),
    category:         trim(r.category),
    cost_centre_code: trim(r.cost_center) || '',
    finance_year:     trim(r.finance_year),
    month_label:      trim(r.month),
    invoice_date:     trim(r.invoiceDate),
    bill_no:          trim(r.bill_no),
    po_no:            trim(r.po_no),
    grn:              trim(r.grn),
    total_amt:        safeInt(r.total),
    tax_amt:          safeInt(r.tax),
    igst:             safeInt(r.igst),
    sgst:             safeInt(r.sgst),
    cgst:             safeInt(r.cgst),
    grand_total:      safeInt(r.grnd),
    gst_type:         trim(r.GSTType),
    status:           r.status === 1 ? 1 : 0,
    payment_status:   trim(r.PaymentStatus),
    receipt_status:   r.ReceiptStatus ? 1 : 0,
    bill_client:      trim(r.cost_client),
    bill_stream:      trim(r.cost_stream),
    bill_process_name: trim(r.cost_process_name),
    bill_branch:      trim(r.branch_name),
    bill_finance_year: trim(r.bill_finance_year),
    carry_forward:    r.carry_forward === 1 ? 1 : 0,
    synced_at:        new Date(),
  }));

  const n = await insertBatch(hrms, 'billing_invoice_snapshot',
    rows,
    ['bill_source_id','invoice_type','category','cost_centre_code','finance_year','month_label',
     'invoice_date','bill_no','po_no','grn','total_amt','tax_amt','igst','sgst','cgst','grand_total',
     'gst_type','status','payment_status','receipt_status',
     'bill_client','bill_stream','bill_process_name','bill_branch','bill_finance_year','carry_forward','synced_at'],
    ['invoice_type','category','cost_centre_code','finance_year','month_label',
     'invoice_date','bill_no','po_no','grn','total_amt','tax_amt','igst','sgst','cgst','grand_total',
     'gst_type','status','payment_status','receipt_status',
     'bill_client','bill_stream','bill_process_name','bill_branch','bill_finance_year','carry_forward','synced_at']
  );
  log('  Upserted: ' + n);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1] ?? 'all';

  log('Connecting to mas_hrms and db_bill ...');
  const hrms = await mysql.createConnection(HRMS);
  const bill = await mysql.createConnection(BILL);
  log('Connected.');

  try {
    if (only === 'all' || only === 'cost_centres') await syncCostCentres(hrms, bill);
    if (only === 'all' || only === 'clients')      await syncClients(hrms, bill);
    if (only === 'all' || only === 'provision')    await syncProvision(hrms, bill);
    if (only === 'all' || only === 'invoices')     await syncInvoices(hrms, bill);

    log('Done.');
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(err => {
  process.stderr.write('FATAL: ' + err.message + '\n');
  process.exit(1);
});
