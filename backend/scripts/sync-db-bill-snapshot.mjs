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
 *   node backend/scripts/sync-db-bill-snapshot.mjs --only=expense_heads
 *   node backend/scripts/sync-db-bill-snapshot.mjs --only=budget
 *   node backend/scripts/sync-db-bill-snapshot.mjs --only=grn
 *   node backend/scripts/sync-db-bill-snapshot.mjs --only=particulars
 *
 * Budget, GRN and invoice lines mirror the CURRENT financial year from April by default.
 * Override with --from=YYYY-MM.
 *
 * Hosts default to the office LAN. Off-LAN, pass the public addresses — which one works
 * flips with the network the machine is on, and the wrong one gives ETIMEDOUT rather than
 * an auth error, so it reads like the database is down when it is not:
 *   --hrms-host=122.184.128.90 --bill-host=14.97.30.236
 */

import mysql from 'mysql2/promise';
import fs from 'fs';

// ── config ────────────────────────────────────────────────────────────────────

const arg = (name, fallback) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

// backend/.env is the same configuration the application itself uses, so a scheduled run
// reaches whichever host the app reaches. Without this the script hardcoded the office-LAN
// address and failed with ETIMEDOUT whenever the machine was off-LAN — which reads like the
// database being down rather than a wrong host. Explicit flags still win, for a manual run.
// Quotes are stripped: backend/.env stores values wrapped in them, and a quoted password
// produces "Access denied", which is indistinguishable from a real credential failure.
function fromEnvFile(key) {
  try {
    const raw = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const line = raw.split(/\r?\n/).find(l => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}

const DB_USER = process.env.DB_USER ?? fromEnvFile('DB_USER') ?? 'shivam_user';
const DB_PASSWORD = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD') ?? 'qwersdfg!@#hjk';

const HRMS = {
  host: arg('hrms-host', process.env.HRMS_DB_HOST ?? fromEnvFile('DB_HOST') ?? '192.168.10.6'),
  port: 3306, user: DB_USER, password: DB_PASSWORD,
  database: 'mas_hrms', connectTimeout: 20000, multipleStatements: false,
};

const BILL = {
  host: arg('bill-host', process.env.BILL_DB_HOST ?? fromEnvFile('BILL_DB_HOST') ?? '192.168.10.22'),
  port: 3306, user: DB_USER, password: DB_PASSWORD,
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

/**
 * Money and quantities, kept exact.
 *
 * safeInt() is right for tbl_invoice, which genuinely holds whole rupees as strings. It is
 * WRONG for the tables added below: expense_entry_master.Amount carries decimals on 6,500
 * rows (Rs 2.15 up to Rs 33,17,122.54) and inv_particulars.qty is fractional on 91 of 540
 * recent rows, because a seat can be billed for part of a month. Using safeInt there would
 * truncate paise on every one of them, silently.
 */
function safeDec(v) {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Full datetime, not the date-only value safeDate() returns — approval times matter. */
function safeDateTime(v) {
  if (!v) return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v).trim();
  return (!s || s.startsWith('0000-00-00')) ? null : s.slice(0, 19);
}

const MONTH_NUM = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * How far back the budget / GRN / invoice-line mirror reaches.
 *
 * Scoped to the current financial year from April rather than all history: db_bill holds
 * 85,463 GRN entries and 18,433 budget rows going back years, and the P&L only works the
 * open year. Override with --from=YYYY-MM.
 *
 * Both a finance-year filter (pushed to db_bill, so the rows never cross the network) and
 * a period_code floor (applied here, because the two systems disagree about month labels)
 * are used. The finance-year filter alone would let Jan-Mar of the SAME finance year
 * through, which are calendar months BEFORE the April start.
 */
function financeYearOf(periodCode) {
  const [y, m] = String(periodCode).split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function currentFinanceYearStart() {
  const now = new Date();
  const year = now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${year}-04`;
}

const FROM_PERIOD = process.argv.find(a => a.startsWith('--from='))?.split('=')[1]
  ?? currentFinanceYearStart();
const FROM_FINANCE_YEAR = financeYearOf(FROM_PERIOD);

/** True when a row belongs on or after the cutoff. Rows with no derivable period are kept
 *  and flagged by period_code IS NULL rather than dropped — losing them silently would be
 *  worse than carrying them. */
function inScope(periodCode) {
  return periodCode === null || periodCode >= FROM_PERIOD;
}

/**
 * A row created BEFORE its own finance year began has the wrong finance year on it.
 *
 * FY2026-27 starts 2026-04-01. Twelve budget rows carry that label but were created in
 * December 2025 and January 2026 — eleven of them in one sitting on 16 Jan 2026, with
 * objectives reading "nth", "nerf", "garg", "fgbrth", "huh". They are test entries filed
 * against the wrong year, and they land in the P&L as Rs 7.27 lakh of budget for months that
 * have not happened. The 102 real budgets created that same month sit correctly under
 * FY2025-26.
 *
 * Safe as a rule here because budgets in this system are entered in the month they apply to:
 * all 439 genuine FY2026-27 rows were created inside the year, in Apr-Jul. If the business
 * ever starts budgeting a year ahead this must be revisited — hence the loud log rather than
 * a silent drop.
 *
 * The real fix belongs in db_bill; this only stops the P&L inheriting the mistake.
 */
function createdBeforeFinanceYear(financeYear, sourceCreatedAt) {
  if (!financeYear || !sourceCreatedAt) return false;
  const start = String(financeYear).match(/^(\d{4})/);
  if (!start) return false;
  return String(sourceCreatedAt).slice(0, 10) < `${start[1]}-04-01`;
}

/**
 * One period_code ('2026-06') from db_bill's three different month dialects.
 *
 *   tbl_invoice.month            'Jun-26'
 *   inv_particulars.month_for    'Jun'
 *   expense_master               FinanceYear '2026-27' + FinanceMonth 'Jun'
 *
 * Deriving it once here means nothing downstream has to guess which dialect a row speaks.
 * An Indian finance year starts in April, so Jan-Mar belong to the SECOND calendar year of
 * '2026-27' — getting that wrong would file three months against the wrong year.
 */
function toPeriodCode(financeYear, monthLabel) {
  const raw = String(monthLabel ?? '').trim().toLowerCase();
  if (!raw) return null;
  const mon = MONTH_NUM[raw.slice(0, 3)];
  if (!mon) return null;

  // 'Jun-26' carries its own year; trust it over the finance year.
  const suffix = raw.match(/-(\d{2})$/);
  if (suffix) return `20${suffix[1]}-${mon}`;

  const fy = String(financeYear ?? '').trim();
  const start = fy.match(/^(\d{4})/);
  if (!start) return null;
  const startYear = Number(start[1]);
  const monthNum = Number(mon);
  return `${monthNum >= 4 ? startYear : startYear + 1}-${mon}`;
}

/**
 * How a line is billed.
 *
 * Derived from the line itself, because the declared field cannot answer it:
 * cost_master.revenueType is blank on 595 of 970 cost centres, and inv_particulars.service
 * is blank on 183 of 356 recent lines carrying Rs 611 lakh — precisely the biggest contracts.
 *
 * What the FY2026-27 invoices actually show, by value:
 *
 *   unit_recurring   Rs 935 lakh over 77 recurring rate lines. A fixed monthly rate per
 *                    unit against a VARYING, usually FRACTIONAL, unit count — Onfido at
 *                    49,910 x 195 then x 175, Bluevine at 27,000 x 64.80 / 66.20 / 62.90,
 *                    BirlaNu at 29,702 x 0.21 / 1.04 / 0.04. The fractions are part-month
 *                    FTEs prorated by deployed days, which is the same proration the seat
 *                    rate resolver applies.
 *   usage            excess usage, talktime top-ups, CTI — varies with volume
 *   one_time         setup, implementation, customisation — must never be annualised
 *   revenue_share    a percentage of the client's own revenue
 *   fixed            same amount every month, qty 1
 *
 * An earlier version of this matched only /seat/. That caught Rs 88 lakh of lines literally
 * labelled "seat" and MISSED the Rs 837 lakh billed as "FTE", "Telecalling" or "Service
 * Charges" — the same per-unit model in different words, and the bulk of the revenue.
 * Matching on the word rather than the shape is why.
 */
function billingPattern(service, particulars, rate, qty, amount) {
  const hay = `${service ?? ''} ${particulars ?? ''}`.toLowerCase();
  if (/revenue share/.test(hay)) return 'revenue_share';
  // A percentage of the client's own value is revenue share however it is worded. These do
  // not say "revenue share" — they say "28% ( On delivered Ordered value of 695249/-" — and
  // because the line is a single unit, rate x 1 == amount held and they were classified as
  // unit_recurring. Seeding a cost-centre rate from one produced Rs 1,94,670 as a "seat
  // rate" for a process whose real rate is Rs 35,000.
  if (/\d\s*%/.test(hay)) return 'revenue_share';
  if (/set ?up cost|implementation|integration charge|customi[sz]ation|development cost/.test(hay))
    return 'one_time';
  if (/excess usage|top ?up|talktime|recharge|cloud telephony|\bcti\b|per (call|minute|transaction|lead|case)/.test(hay))
    return 'usage';
  if (/retainer|subscription/.test(hay)) return 'fixed';
  // Shape beats vocabulary: a rate against a real unit count is per-unit billing whatever
  // the line happens to be called.
  if (/seat|fte|manpower|deployment|resource|telecalling|service charges/.test(hay)) return 'unit_recurring';
  const r = safeDec(rate), q = safeDec(qty), a = safeDec(amount);
  if (r > 0 && q > 0 && a > 0 && Math.abs(r * q - a) < 1) return 'unit_recurring';
  return 'fixed';
}

/**
 * True where `rate` may be read as a monthly rate per person.
 *
 * Only unit_recurring lines qualify, and even then it is a candidate rather than a
 * guarantee: BSS/OB/NOIDA-DD/993 billed 38,000 x 2 in June and 76,000 x 1 in July for the
 * same invoice value, so the rate/qty split is not always the per-person one.
 */
function isSeatLine(service, particulars, rate, qty, amount) {
  return billingPattern(service, particulars, rate, qty, amount) === 'unit_recurring' ? 1 : 0;
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

// ── Sync 5: expense head / sub-head masters ───────────────────────────────────

/**
 * Without these, head_id on the budget and GRN snapshots is an opaque string.
 *
 * The ids are copied VERBATIM as text. They are unique as strings (52 of 52) but collapse
 * to 31 as integers, because zero-padded and unpadded forms coexist and mean different
 * heads: '000001' is Communication & Connectivity while '1' is Security Service Charges.
 * Any numeric cast merges them and mislabels every cost posted against them.
 */
async function syncExpenseHeads(hrms, bill) {
  log('Sync 5: populating finance_expense_head_snapshot from db_bill.tbl_bgt_expense*master ...');
  const now = new Date();

  const [heads] = await bill.query(
    'SELECT HeadingId, HeadingDesc, close_status FROM tbl_bgt_expenseheadingmaster');
  const [subs] = await bill.query(
    'SELECT SubHeadingId, HeadingId, SubHeadingDesc, sub_close_status FROM tbl_bgt_expensesubheadingmaster');

  const rows = [
    ...heads.map(r => ({
      bill_source_id: String(r.HeadingId), head_type: 'head', parent_head_id: null,
      head_name: trim(r.HeadingDesc), active_status: r.close_status === 1 ? 1 : 0, synced_at: now,
    })),
    ...subs.map(r => ({
      bill_source_id: String(r.SubHeadingId), head_type: 'subhead', parent_head_id: String(r.HeadingId),
      head_name: trim(r.SubHeadingDesc), active_status: r.sub_close_status === 1 ? 1 : 0, synced_at: now,
    })),
  ];

  const n = await insertBatch(hrms, 'finance_expense_head_snapshot', rows,
    ['bill_source_id', 'head_type', 'parent_head_id', 'head_name', 'active_status', 'synced_at'],
    ['parent_head_id', 'head_name', 'active_status', 'synced_at']);
  log(`  finance_expense_head_snapshot: ${n} rows (${heads.length} heads, ${subs.length} sub-heads)`);
}

// ── Sync 6: budget ────────────────────────────────────────────────────────────

async function syncBudget(hrms, bill) {
  log('Sync 6: populating finance_budget_snapshot from db_bill.expense_master ...');
  const now = new Date();

  const [src] = await bill.query(
    `SELECT m.Id, m.BranchId, m.Branch, m.EntryNo, m.FinanceYear, m.FinanceMonth,
            m.HeadId, m.SubHeadId, m.Amount, m.expense_status, m.EntryStatus,
            m.ApproveDate1, m.ApproveDate2, m.ApproveDate3, m.ApproveDate4, m.ApproveDate5,
            m.objective, m.Description_Det, m.createdate
       FROM expense_master m WHERE m.FinanceYear >= ? ORDER BY m.Id`, [FROM_FINANCE_YEAR]);
  log(`  db_bill.expense_master rows from ${FROM_FINANCE_YEAR}: ${src.length}`);

  const rows = src.map(r => ({
    bill_source_id: r.Id,
    branch_source_id: r.BranchId ?? null,
    branch_name: trim(r.Branch),
    entry_no: trim(r.EntryNo),
    finance_year: trim(r.FinanceYear),
    finance_month: trim(r.FinanceMonth),
    period_code: toPeriodCode(r.FinanceYear, r.FinanceMonth),
    head_id: trim(r.HeadId),
    sub_head_id: trim(r.SubHeadId),
    amount: safeDec(r.Amount),
    expense_status: trim(r.expense_status),
    entry_status: trim(r.EntryStatus),
    approve_1_at: safeDateTime(r.ApproveDate1),
    approve_2_at: safeDateTime(r.ApproveDate2),
    approve_3_at: safeDateTime(r.ApproveDate3),
    approve_4_at: safeDateTime(r.ApproveDate4),
    approve_5_at: safeDateTime(r.ApproveDate5),
    objective: trim(r.objective),
    description_det: trim(r.Description_Det),
    source_created_at: safeDateTime(r.createdate),
    synced_at: now,
  }));

  const cols = ['bill_source_id','branch_source_id','branch_name','entry_no','finance_year',
    'finance_month','period_code','head_id','sub_head_id','amount','expense_status','entry_status',
    'approve_1_at','approve_2_at','approve_3_at','approve_4_at','approve_5_at','objective',
    'description_det','source_created_at','synced_at'];

  const misfiled = rows.filter(r => createdBeforeFinanceYear(r.finance_year, r.source_created_at));
  if (misfiled.length) {
    const value = misfiled.reduce((sum, r) => sum + Number(r.amount), 0);
    log(`  WARNING: ${misfiled.length} budget row(s) worth Rs ${(value / 100000).toFixed(2)} lakh carry a finance year that`);
    log(`           began AFTER they were created — they are mis-filed and are being excluded.`);
    for (const r of misfiled.slice(0, 12)) {
      log(`           id=${r.bill_source_id} ${r.finance_year}/${r.finance_month} created ${String(r.source_created_at).slice(0, 10)} Rs ${r.amount} "${String(r.objective ?? '').slice(0, 20)}"`);
    }
    log(`           Fix them in db_bill.expense_master; this only stops the P&L inheriting the error.`);

    // Excluding them from the write is not enough on its own. Every sync here is
    // INSERT ... ON DUPLICATE KEY UPDATE, so a row mirrored by an earlier run stays until it
    // is explicitly removed — the first run of this guard left all Rs 7.27 lakh sitting in
    // the snapshot while reporting that it had skipped them. Delete by the exact ids just
    // identified, so the mirror is corrected without touching anything else.
    const ids = misfiled.map(r => r.bill_source_id);
    const [res] = await hrms.query(
      `DELETE FROM finance_budget_snapshot WHERE bill_source_id IN (${ids.map(() => '?').join(',')})`, ids);
    if (res.affectedRows) log(`           removed ${res.affectedRows} previously-mirrored row(s) from the snapshot.`);
  }

  const scoped = rows.filter(r => inScope(r.period_code)
                               && !createdBeforeFinanceYear(r.finance_year, r.source_created_at));
  const n = await insertBatch(hrms, 'finance_budget_snapshot', scoped, cols, cols.slice(1));
  log(`  finance_budget_snapshot: ${n} rows (from ${FROM_PERIOD}; ${rows.length - scoped.length} skipped as out of range or mis-filed)`);
}

// ── Sync 7: GRN / expense entries ─────────────────────────────────────────────

async function syncGrnEntries(hrms, bill) {
  log('Sync 7: populating grn_entry_snapshot from db_bill.expense_entry_master ...');
  const now = new Date();

  const [src] = await bill.query(
    `SELECT e.Id, e.GrnNo, e.BranchId, bm.branch_name, e.Vendor, e.FinanceYear, e.FinanceMonth,
            e.HeadId, e.SubHeadId, e.Amount, e.CGST, e.SGST, e.IGST,
            e.ExpenseDate, e.bill_no, e.bill_date, e.EntryStatus, e.grn_status,
            e.Reject, e.RejectDate, e.ApprovalDate, e.approved_by_ph_date, e.approved_by_fh_date,
            e.Description, e.createdate
       FROM expense_entry_master e
       LEFT JOIN branch_master bm ON bm.id = e.BranchId
      WHERE e.FinanceYear >= ? ORDER BY e.Id`, [FROM_FINANCE_YEAR]);
  log(`  db_bill.expense_entry_master rows from ${FROM_FINANCE_YEAR}: ${src.length}`);

  const rows = src.map(r => ({
    bill_source_id: r.Id,
    grn_no: trim(r.GrnNo),
    branch_source_id: r.BranchId ?? null,
    // The branch NAME, resolved from db_bill's branch_master. Leaving this null meant a
    // budget-vs-actual by branch matched nothing and reported every rupee of spend against a
    // null branch: branch_source_id is db_bill's integer id and does not join to mas_hrms.
    // Cost centre remains the more reliable route (it carries the mas_hrms branch_id); this is
    // the fallback for lines whose cost centre does not resolve.
    branch_name: trim(r.branch_name),
    vendor: trim(r.Vendor),
    finance_year: trim(r.FinanceYear),
    finance_month: trim(r.FinanceMonth),
    period_code: toPeriodCode(r.FinanceYear, r.FinanceMonth),
    head_id: trim(r.HeadId),
    sub_head_id: trim(r.SubHeadId),
    amount: safeDec(r.Amount),
    cgst: safeDec(r.CGST),
    sgst: safeDec(r.SGST),
    igst: safeDec(r.IGST),
    expense_date: trim(r.ExpenseDate),
    bill_no: trim(r.bill_no),
    bill_date: trim(r.bill_date),
    entry_status: trim(r.EntryStatus),
    grn_status: trim(r.grn_status),
    reject_flag_raw: r.Reject ?? null,
    // NOT r.Reject. That flag is 1 on 85,255 of 85,463 rows while only 1,894 carry a
    // RejectDate and 80,074 carry an ApprovalDate — it is the default state, not a
    // rejection. Reading the flag would mark 99.8% of GRNs rejected.
    is_rejected: safeDateTime(r.RejectDate) ? 1 : 0,
    rejected_at: safeDateTime(r.RejectDate),
    approved_at: safeDateTime(r.ApprovalDate),
    approved_by_ph_at: safeDateTime(r.approved_by_ph_date),
    approved_by_fh_at: safeDateTime(r.approved_by_fh_date),
    description: trim(r.Description),
    source_created_at: safeDateTime(r.createdate),
    synced_at: now,
  }));

  const cols = ['bill_source_id','grn_no','branch_source_id','branch_name','vendor','finance_year',
    'finance_month','period_code','head_id','sub_head_id','amount','cgst','sgst','igst',
    'expense_date','bill_no','bill_date','entry_status','grn_status','reject_flag_raw',
    'is_rejected','rejected_at','approved_at','approved_by_ph_at','approved_by_fh_at',
    'description','source_created_at','synced_at'];
  const scoped = rows.filter(r => inScope(r.period_code));
  const n = await insertBatch(hrms, 'grn_entry_snapshot', scoped, cols, cols.slice(1));
  log(`  grn_entry_snapshot: ${n} rows from ${FROM_PERIOD} (${scoped.filter(r => r.is_rejected).length} genuinely rejected)`);
}

// ── Sync 8: invoice line items — the cost-centre-wise seat rate ────────────────

async function syncInvoiceParticulars(hrms, bill) {
  log('Sync 8: populating billing_invoice_particular_snapshot from db_bill.inv_particulars ...');
  const now = new Date();

  const [src] = await bill.query(
    `SELECT p.id, p.cost_center_id, p.cost_center, p.branch_name, p.fin_year, p.month_for,
            p.service, p.sub_category, p.particulars, p.rate, p.qty, p.amount, p.createdate
       FROM inv_particulars p WHERE p.fin_year >= ? ORDER BY p.id`, [FROM_FINANCE_YEAR]);
  log(`  db_bill.inv_particulars rows from ${FROM_FINANCE_YEAR}: ${src.length}`);

  const rows = src.map(r => ({
    bill_source_id: r.id,
    cost_centre_source_id: r.cost_center_id ?? null,
    cost_centre_code: trim(r.cost_center),
    branch_name: trim(r.branch_name),
    finance_year: trim(r.fin_year),
    month_for: trim(r.month_for),
    period_code: toPeriodCode(r.fin_year, r.month_for),
    service: trim(r.service),
    sub_category: trim(r.sub_category),
    particulars: trim(r.particulars),
    rate: safeDec(r.rate),
    qty: safeDec(r.qty),
    amount: safeDec(r.amount),
    billing_pattern: billingPattern(r.service, r.particulars, r.rate, r.qty, r.amount),
    is_seat_line: isSeatLine(r.service, r.particulars, r.rate, r.qty, r.amount),
    source_created_at: safeDateTime(r.createdate),
    synced_at: now,
  }));

  const cols = ['bill_source_id','cost_centre_source_id','cost_centre_code','branch_name',
    'finance_year','month_for','period_code','service','sub_category','particulars',
    'rate','qty','amount','billing_pattern','is_seat_line','source_created_at','synced_at'];
  const scoped = rows.filter(r => inScope(r.period_code));
  const n = await insertBatch(hrms, 'billing_invoice_particular_snapshot', scoped, cols, cols.slice(1));
  log(`  billing_invoice_particular_snapshot: ${n} rows from ${FROM_PERIOD} (${scoped.filter(r => r.is_seat_line).length} seat-priced lines)`);
}


// ── Sync 9: budget LINES ──────────────────────────────────────────────────────

/**
 * The line level of the budget. Carries expense_type, which decides whether a line is
 * attributed to a cost centre or is a manual particular — and which MUST be filtered on when
 * aggregating, because the two types are the same money recorded twice (Rs 375.75 lakh as
 * 'CostCenter' plus Rs 374.54 lakh as 'Particular' against a Rs 375.14 lakh header total).
 */
async function syncBudgetLines(hrms, bill) {
  log('Sync 9: populating finance_budget_line_snapshot from db_bill.expense_particular ...');
  const now = new Date();
  const [src] = await bill.query(
    `SELECT p.Id, p.ExpenseId, p.BranchId, p.FinanceYear, p.FinanceMonth, p.HeadId, p.SubHeadId,
            p.ExpenseType, p.ExpenseTypeName, p.Amount, p.AmountPercent, p.createdate
       FROM expense_particular p
       JOIN expense_master m ON m.Id = p.ExpenseId
      WHERE m.FinanceYear >= ? AND m.createdate >= ?
      ORDER BY p.Id`, [FROM_FINANCE_YEAR, `${FROM_FINANCE_YEAR.slice(0, 4)}-04-01`]);
  log(`  db_bill.expense_particular rows from ${FROM_FINANCE_YEAR}: ${src.length}`);

  const rows = src.map(r => ({
    bill_source_id: r.Id,
    budget_source_id: r.ExpenseId ?? null,
    branch_source_id: r.BranchId ?? null,
    finance_year: trim(r.FinanceYear),
    finance_month: trim(r.FinanceMonth),
    period_code: toPeriodCode(r.FinanceYear, r.FinanceMonth),
    head_id: trim(r.HeadId),
    sub_head_id: trim(r.SubHeadId),
    expense_type: trim(r.ExpenseType),
    expense_type_name: trim(r.ExpenseTypeName),
    amount: safeDec(r.Amount),
    amount_percent: trim(r.AmountPercent),
    source_created_at: safeDateTime(r.createdate),
    synced_at: now,
  }));
  const cols = ['bill_source_id','budget_source_id','branch_source_id','finance_year','finance_month',
    'period_code','head_id','sub_head_id','expense_type','expense_type_name','amount','amount_percent',
    'source_created_at','synced_at'];
  const scoped = rows.filter(r => inScope(r.period_code));
  const n = await insertBatch(hrms, 'finance_budget_line_snapshot', scoped, cols, cols.slice(1));
  const cc = scoped.filter(r => r.expense_type === 'CostCenter').length;
  log(`  finance_budget_line_snapshot: ${n} rows (${cc} cost-centre attributed, ${scoped.length - cc} manual particulars)`);
}

// ── Sync 10: GRN LINES — the cost-centre attribution ──────────────────────────

async function syncGrnLines(hrms, bill) {
  log('Sync 10: populating grn_entry_line_snapshot from db_bill.expense_entry_particular ...');
  const now = new Date();
  const [src] = await bill.query(
    `SELECT p.Id, p.ExpenseEntry, p.BranchId, p.CostCenterId, cm.cost_center,
            p.ExpenseEntryType, p.Particular, p.Amount, p.Rate, p.Tax, p.Total, p.createdate,
            m.FinanceYear, m.FinanceMonth
       FROM expense_entry_particular p
       JOIN expense_entry_master m ON m.Id = p.ExpenseEntry
       LEFT JOIN cost_master cm ON cm.id = p.CostCenterId
      WHERE m.FinanceYear >= ?
      ORDER BY p.Id`, [FROM_FINANCE_YEAR]);
  log(`  db_bill.expense_entry_particular rows from ${FROM_FINANCE_YEAR}: ${src.length}`);

  const rows = src.map(r => ({
    bill_source_id: r.Id,
    grn_source_id: r.ExpenseEntry ? Number(r.ExpenseEntry) : null,
    branch_source_id: r.BranchId ?? null,
    cost_centre_source_id: r.CostCenterId ? Number(r.CostCenterId) : null,
    cost_centre_code: trim(r.cost_center),
    entry_type: trim(r.ExpenseEntryType),
    particular: trim(r.Particular),
    amount: safeDec(r.Amount),
    tax_rate: safeDec(r.Rate),
    tax: safeDec(r.Tax),
    total: safeDec(r.Total),
    source_created_at: safeDateTime(r.createdate),
    synced_at: now,
    _period: toPeriodCode(r.FinanceYear, r.FinanceMonth),
  }));
  const cols = ['bill_source_id','grn_source_id','branch_source_id','cost_centre_source_id',
    'cost_centre_code','entry_type','particular','amount','tax_rate','tax','total',
    'source_created_at','synced_at'];
  const scoped = rows.filter(r => inScope(r._period));
  const n = await insertBatch(hrms, 'grn_entry_line_snapshot', scoped, cols, cols.slice(1));
  const withCc = scoped.filter(r => r.cost_centre_source_id).length;
  log(`  grn_entry_line_snapshot: ${n} rows (${withCc} carry a cost centre, ${scoped.length - withCc} do not)`);
}

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
    // Heads first: the budget and GRN snapshots reference them.
    if (only === 'all' || only === 'expense_heads') await syncExpenseHeads(hrms, bill);
    if (only === 'all' || only === 'budget')        await syncBudget(hrms, bill);
    if (only === 'all' || only === 'grn')           await syncGrnEntries(hrms, bill);
    if (only === 'all' || only === 'particulars')   await syncInvoiceParticulars(hrms, bill);
    if (only === 'all' || only === 'budget_lines')  await syncBudgetLines(hrms, bill);
    if (only === 'all' || only === 'grn_lines')     await syncGrnLines(hrms, bill);

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
