/**
 * migrate-grn-from-dbbill.ts
 *
 * Migrates ALL GRN expense records from db_bill → mas_hrms.grn_request.
 * Types migrated: Vendor, Imprest, Salary (NULL/garbage rows are skipped).
 * Covers all financial years (2017-18 through present).
 *
 * Also creates:
 *   - vendor_payment_tracking for Vendor GRNs at Booked/Close status
 *   - vendor_payment_transaction for each tbl_payment_processing record
 *
 * USAGE
 *   npx ts-node backend/scripts/migrate-grn-from-dbbill.ts            # dry-run
 *   npx ts-node backend/scripts/migrate-grn-from-dbbill.ts --apply    # write
 *   npx ts-node backend/scripts/migrate-grn-from-dbbill.ts --apply --batch-size=500
 *   npx ts-node backend/scripts/migrate-grn-from-dbbill.ts --apply --fy=2026-27  # one FY only
 *
 * PREREQUISITES
 *   Migration 1248 must be applied (adds bill_source_id columns + branch map + sentinel user).
 *   Idempotent: rows already in grn_request with a matching bill_source_id are skipped.
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';

const APPLY      = process.argv.includes('--apply');
const FY_FILTER  = process.argv.find(a => a.startsWith('--fy='))?.split('=')[1] ?? null;
const BATCH_SIZE = parseInt(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] ?? '500', 10);
const MIGRATION_USER = '00000000-0000-0000-0000-dbbill000001';

// ─── Month name → 2-digit month number ────────────────────────────────────
const MONTH_MAP: Record<string, string> = {
  Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
  Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
};

// ─── FY + Month → YYYY-MM period_code ─────────────────────────────────────
function periodCode(fy: string | null, month: string | null): string | null {
  if (!fy || !month) return null;
  const mm = MONTH_MAP[month];
  if (!mm) return null;
  // '2026-27' Apr..Mar: Apr-Mar = calendar 2026; Jan-Mar = calendar 2027
  const startYear = parseInt(fy.split('-')[0], 10);
  const year = (parseInt(mm, 10) >= 4) ? startYear : startYear + 1;
  return `${year}-${mm}`;
}

// ─── Safe decimal parse ────────────────────────────────────────────────────
function safeDecimal(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

// ─── Safe date parse — handles 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY' ──
function safeDate(v: unknown): string | null {
  if (!v || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (mdy) {
    const yr = parseInt(mdy[3], 10);
    return `${yr < 50 ? 2000+yr : 1900+yr}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  }
  return null;
}

// ─── GRN status mapping ────────────────────────────────────────────────────
type GrnStatus = 'draft'|'submitted'|'branch_head_approved'|'finance_head_approved'|
  'pending_accounts_payment'|'paid'|'approved'|'cancelled';

function resolveStatus(
  entryType: string,
  entryStatus: string | null,
  isRejected: number,
  approvalDate: Date | null,
  approvedByPhDate: Date | null,
  approvedByFhDate: Date | null,
): GrnStatus {
  if (isRejected) return 'cancelled';

  const status = (entryStatus ?? 'Open').trim();

  if (entryType === 'Salary') {
    if (status === 'Close' || status === 'Booked') return 'paid';
    // Auto-generated salary GRNs always have an ApprovalDate
    if (approvalDate) return 'approved';
    return 'submitted';
  }

  if (entryType === 'Imprest') {
    if (status === 'Close') return 'paid';
    if (status === 'Booked') return 'branch_head_approved';
    if (approvedByPhDate || approvalDate) return 'branch_head_approved';
    return 'submitted';
  }

  // Vendor (default)
  if (status === 'Close') return 'paid';
  if (status === 'Booked') return 'pending_accounts_payment';
  if (approvedByFhDate) return 'finance_head_approved';
  if (approvedByPhDate) return 'branch_head_approved';
  if (approvalDate) return 'submitted';
  return 'submitted';
}

// ─── Payment mode decode for vendor_payment_transaction ───────────────────
type PayMode = 'Cheque'|'NEFT'|'RTGS'|'IMPS'|'UPI'|'Cash'|'Bank Transfer'|'Adjustment'|'Other';
function decodePaymentMode(raw: string | null): PayMode {
  if (!raw) return 'Other';
  const r = raw.trim().toLowerCase();
  if (r === 'cheque' || r === 'check') return 'Cheque';
  if (r === 'neft')   return 'NEFT';
  if (r === 'rtgs')   return 'RTGS';
  if (r === 'imps')   return 'IMPS';
  if (r === 'upi')    return 'UPI';
  if (r === 'cash')   return 'Cash';
  return 'Other';
}

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST, port: Number(process.env.BILL_DB_PORT ?? 3306),
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD, database: process.env.BILL_DB_NAME,
  });

  try {
    // ── Load lookup maps ───────────────────────────────────────────────────

    // Branch map: db_bill BranchId → hrms UUID
    const [branchRows] = await hrms.query<any[]>(
      'SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map'
    );
    const branchMap = new Map<number, string>(branchRows.map(r => [r.dbbill_branch_id, r.hrms_branch_id]));

    // Vendor map: db_bill vendor Id → { hrms_id, vendor_name }
    const [vendorRows] = await hrms.query<any[]>(
      "SELECT id, vendor_name, vendor_code FROM vendor_master WHERE vendor_code LIKE 'DB_BILL_%'"
    );
    const vendorMap = new Map<number, { id: string; name: string }>(
      vendorRows.map(r => {
        const legacyId = parseInt(String(r.vendor_code).replace('DB_BILL_', ''), 10);
        return [legacyId, { id: r.id, name: r.vendor_name }];
      })
    );

    // Head map: db_bill HeadingId (string) → HeadingDesc
    const [headRows] = await bill.query<any[]>(
      'SELECT HeadingId, HeadingDesc FROM tbl_bgt_expenseheadingmaster'
    );
    const headMap = new Map<string, string>(headRows.map(r => [String(r.HeadingId).trim(), String(r.HeadingDesc ?? '').trim()]));

    // SubHead map: db_bill SubHeadingId (string) → SubHeadingDesc
    const [subheadRows] = await bill.query<any[]>(
      'SELECT SubHeadingId, SubHeadingDesc FROM tbl_bgt_expensesubheadingmaster'
    );
    const subheadMap = new Map<string, string>(subheadRows.map(r => [String(r.SubHeadingId).trim(), String(r.SubHeadingDesc ?? '').trim()]));

    // CostCentre map: db_bill cost_master.id (INT) → mas_hrms cost_centre_master.id (UUID)
    const [ccRows] = await hrms.query<any[]>(
      'SELECT id, bill_source_id FROM cost_centre_master WHERE bill_source_id IS NOT NULL'
    );
    const ccMap = new Map<number, string>(ccRows.map(r => [r.bill_source_id as number, r.id as string]));

    // Already-migrated bill_source_ids (idempotency)
    const [existingRows] = await hrms.query<any[]>(
      'SELECT bill_source_id FROM grn_request WHERE bill_source_id IS NOT NULL'
    );
    const alreadyDone = new Set<number>(existingRows.map(r => r.bill_source_id as number));

    // Cost-centre per GRN is resolved from grn_entry_line_snapshot (already in mas_hrms
    // with cost_centre_source_id→UUID resolution done). Querying db_bill expense_entry_particular
    // directly via a full GROUP BY causes ECONNRESET on MySQL 5.5 for large result sets.
    // Use the snapshot table instead — 100% match rate already verified.
    console.log(' Loading cost-centre per GRN from grn_entry_line_snapshot (mas_hrms)...');
    const [particularRows] = await hrms.query<any[]>(
      `SELECT l.grn_source_id, MIN(cc.id) AS hrms_cc_id
       FROM grn_entry_line_snapshot l
       INNER JOIN cost_centre_master cc ON cc.cost_centre_code = l.cost_centre_code
       GROUP BY l.grn_source_id`
    );
    // grn_source_id is db_bill expense_entry_master.Id → cost_centre_master.id
    const grnCcMap = new Map<number, string>(
      particularRows.map(r => [r.grn_source_id as number, r.hrms_cc_id as string])
    );
    console.log(` Loaded ${grnCcMap.size.toLocaleString()} snapshot GRN→cost-centre mappings.`);
    console.log(` Note: cost_centre_id will be NULL for rows not in the FY2026-27 snapshot;`);
    console.log(` run the snapshot sync for older FYs to backfill.\n`);

    // Payment processing map: db_bill GrnId → list of payments
    const [payRows] = await bill.query<any[]>(
      'SELECT Id, GrnId, PaymentMode, PaymentDate, BankName, TransactionId, CreateDate FROM tbl_payment_processing WHERE GrnId IS NOT NULL'
    );
    const payMap = new Map<number, any[]>();
    for (const p of payRows) {
      if (!payMap.has(p.GrnId)) payMap.set(p.GrnId, []);
      payMap.get(p.GrnId)!.push(p);
    }

    // ── Count source rows ──────────────────────────────────────────────────
    const fyClause = FY_FILTER ? `AND FinanceYear = ${bill.escape(FY_FILTER)}` : '';
    const [countRows] = await bill.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM expense_entry_master
       WHERE ExpenseEntryType IN ('Vendor','Imprest','Salary') ${fyClause}`
    );
    const totalSource = countRows[0].cnt as number;
    const toProcess   = totalSource - alreadyDone.size;

    console.log('\n────────────────────────────────────────────────────────');
    console.log(' db_bill → mas_hrms GRN migration');
    console.log('────────────────────────────────────────────────────────');
    console.log(` Mode         : ${APPLY ? 'APPLY (writes to DB)' : 'DRY RUN (no writes)'}`);
    console.log(` FY filter    : ${FY_FILTER ?? 'all years'}`);
    console.log(` Batch size   : ${BATCH_SIZE}`);
    console.log(` Source rows  : ${totalSource.toLocaleString()} (Vendor + Imprest + Salary)`);
    console.log(` Already done : ${alreadyDone.size.toLocaleString()}`);
    console.log(` To process   : ${toProcess.toLocaleString()}`);
    console.log(` Branch map   : ${branchMap.size} branches`);
    console.log(` Vendor map   : ${vendorMap.size} vendors`);
    console.log(` CC map       : ${ccMap.size} cost centres`);
    console.log('────────────────────────────────────────────────────────\n');

    if (toProcess === 0) {
      console.log('Nothing to migrate — all source rows already present in grn_request.');
      return;
    }

    // ── Pre-load existing GRN numbers to detect db_bill duplicates ────────
    // db_bill has 394 GRN numbers appearing on multiple rows (different expenses
    // sharing a number). We suffix duplicates with -{bill_source_id} so all rows
    // are preserved uniquely.
    const [existingGrnNos] = await hrms.query<any[]>(
      'SELECT grn_number FROM grn_request WHERE grn_number IS NOT NULL'
    );
    const usedGrnNumbers = new Set<string>(existingGrnNos.map(r => String(r.grn_number)));

    // ── Process in batches ─────────────────────────────────────────────────
    let offset = 0;
    let inserted = 0;
    let skipped  = 0;
    let warnings: string[] = [];
    let grnDupCount = 0;

    const stats = { Vendor: 0, Imprest: 0, Salary: 0 };
    const statusCounts: Record<string, number> = {};
    let branchMissCount = 0;
    let headMissCount   = 0;
    let vptInserted     = 0;
    let vptxInserted    = 0;

    while (true) {
      const [rows] = await bill.query<any[]>(
        `SELECT * FROM expense_entry_master
         WHERE ExpenseEntryType IN ('Vendor','Imprest','Salary') ${fyClause}
         ORDER BY Id
         LIMIT ${BATCH_SIZE} OFFSET ${offset}`
      );

      if (rows.length === 0) break;
      offset += rows.length;

      for (const row of rows) {
        const billId = row.Id as number;
        if (alreadyDone.has(billId)) { skipped++; continue; }

        // ── Resolve fields ─────────────────────────────────────────────
        const entryType: string = (row.ExpenseEntryType ?? 'Vendor').trim();
        const grn_type = entryType === 'Imprest' ? 'imprest'
                       : entryType === 'Salary'  ? 'salary'
                       : 'vendor';

        // Resolve branch: use BranchId directly; if null, parse from GRN number "Mas/11/17/xxx"
        let rawBranchId = row.BranchId as number | null;
        if (!rawBranchId && row.GrnNo) {
          const m = String(row.GrnNo).match(/^[A-Za-z]+\/(\d+)\//);
          if (m) rawBranchId = parseInt(m[1], 10);
        }
        const branchId = rawBranchId ? branchMap.get(rawBranchId) : null;
        if (!branchId) {
          branchMissCount++;
          warnings.push(`bill_source_id=${billId}: unmapped BranchId=${row.BranchId}, GRN=${row.GrnNo}`);
          skipped++;
          continue;
        }

        const headId    = row.HeadId    ? String(row.HeadId).trim()    : null;
        const subHeadId = row.SubHeadId ? String(row.SubHeadId).trim() : null;
        const headName    = headId    ? (headMap.get(headId)    ?? headId)    : '';
        const subHeadName = subHeadId ? (subheadMap.get(subHeadId) ?? subHeadId) : '';
        if (headId && !headMap.has(headId)) headMissCount++;

        const amount        = safeDecimal(row.Amount);
        const cgst          = safeDecimal(row.CGST);
        const sgst          = safeDecimal(row.SGST);
        const igst          = safeDecimal(row.IGST);
        const taxAmount     = cgst + sgst + igst;
        const amountWithTax = amount + taxAmount;
        const gstType: string = (igst > 0) ? 'igst' : (cgst > 0 || sgst > 0) ? 'cgst_sgst' : 'none';
        const gstRate: number = amount > 0 && taxAmount > 0
          ? parseFloat(((taxAmount / amount) * 100).toFixed(4)) : 0;

        const billDate    = safeDate(row.bill_date ?? row.ExpenseDate);
        const dueDate     = safeDate(row.due_date);
        const fy: string  = row.FinanceYear ?? '';
        const month: string = row.FinanceMonth ?? '';
        const accPeriod   = periodCode(fy, month);

        const vendor = vendorMap.get(row.Vendor as number);
        const vendorId   = vendor?.id   ?? null;
        const vendorName = vendor?.name ?? null;

        // grnCcMap: bill_source_id → hrms cost_centre UUID (from snapshot; NULL for pre-FY2026-27 rows)
        const ccId = grnCcMap.get(billId) ?? null;

        const isRejected  = row.RejectDate ? 1 : 0;
        const approvalDate   = row.ApprovalDate   ? new Date(row.ApprovalDate)       : null;
        const phDate         = row.approved_by_ph_date ? new Date(row.approved_by_ph_date) : null;
        const fhDate         = row.approved_by_fh_date ? new Date(row.approved_by_fh_date) : null;
        const status = resolveStatus(entryType, row.EntryStatus, isRejected, approvalDate, phDate, fhDate);

        // Handle duplicate GRN numbers from db_bill — suffix with bill_source_id
        let grnNumber: string | null = row.GrnNo ?? null;
        if (grnNumber && usedGrnNumbers.has(grnNumber)) {
          grnNumber = `${grnNumber}-${billId}`;
          grnDupCount++;
        }
        if (grnNumber) usedGrnNumbers.add(grnNumber);

        const grnId = uuidv4();
        const createdAt = row.createdate ? new Date(row.createdate) : new Date();

        if (!APPLY) {
          inserted++;
          stats[entryType as keyof typeof stats]++;
          statusCounts[status] = (statusCounts[status] ?? 0) + 1;
          continue;
        }

        // ── INSERT grn_request ─────────────────────────────────────────
        await hrms.execute(
          `INSERT INTO grn_request (
             id, grn_number, grn_type, branch_id, vendor_id, vendor_name,
             head, sub_head,
             quantity, unit_rate,
             tax_treatment, gst_rate, gst_type,
             amount_without_tax, tax_amount, amount_with_tax, pnl_cost_amount, amount,
             bill_date, due_date, description,
             status, financial_year, accounting_period,
             cost_centre_id,
             bill_source_id, created_by, created_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            grnId,
            grnNumber,
            grn_type,
            branchId,
            vendorId,
            vendorName,
            headName || null,
            subHeadName || null,
            1,                  // quantity
            amount,             // unit_rate = amount (no unit breakdown in legacy)
            'inclusive',        // legacy GRNs stored tax-inclusive amounts
            gstRate,
            gstType,
            amount_without_tax(amount, taxAmount),
            taxAmount,
            amountWithTax,
            amountWithTax,      // pnl_cost_amount = total
            amount,
            billDate,
            dueDate,
            row.Description ?? row.Remarks ?? null,
            status,
            fy || null,
            accPeriod,
            ccId,
            billId,
            MIGRATION_USER,
            createdAt,
          ]
        );

        inserted++;
        alreadyDone.add(billId);
        stats[entryType as keyof typeof stats]++;
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;

        // ── vendor_payment_tracking for vendor GRNs ──────────────────
        if (grn_type === 'vendor' && (status === 'pending_accounts_payment' || status === 'paid')) {
          const vptId = uuidv4();
          const vptStatus = status === 'paid' ? 'Paid' : 'Payment Pending';
          await hrms.execute(
            `INSERT IGNORE INTO vendor_payment_tracking (
               id, grn_request_id, grn_number, branch_id, vendor_id, vendor_name,
               head, sub_head, due_amount, due_date,
               paid_amount, balance_amount,
               payment_status, financial_year,
               amount_without_tax, tax_amount, amount_with_tax,
               cost_centre_id,
               created_at
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              vptId, grnId, grnNumber, branchId, vendorId, vendorName,
              headName || null, subHeadName || null,
              amountWithTax, dueDate,
              status === 'paid' ? amountWithTax : 0,
              status === 'paid' ? 0 : amountWithTax,
              vptStatus, fy || null,
              amount_without_tax(amount, taxAmount), taxAmount, amountWithTax,
              ccId,
              createdAt,
            ]
          );
          vptInserted++;

          // ── vendor_payment_transaction from tbl_payment_processing ────
          const payments = payMap.get(billId) ?? [];
          for (const pay of payments) {
            const vtxId = uuidv4();
            await hrms.execute(
              `INSERT IGNORE INTO vendor_payment_transaction (
                 id, vendor_payment_id, grn_request_id, sequence_no,
                 payment_mode, payment_date, bank_name, transaction_id,
                 amount, tds_amount, net_amount, created_by, created_at
               ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [
                vtxId, vptId, grnId,
                pay.Id,
                decodePaymentMode(pay.PaymentMode),
                safeDate(pay.PaymentDate),
                pay.BankName ?? null,
                pay.TransactionId ?? null,
                amountWithTax,   // amount column — tbl_payment_processing has no amount
                0, 0,
                MIGRATION_USER,
                pay.CreateDate ? new Date(pay.CreateDate) : createdAt,
              ]
            );
            vptxInserted++;
          }
        }

        if (inserted % 500 === 0) {
          process.stdout.write(`\r  Progress: ${inserted.toLocaleString()} inserted, ${skipped} skipped ...`);
        }
      }

      if (rows.length < BATCH_SIZE) break;
    }

    // ── Report ──────────────────────────────────────────────────────────
    console.log(`\n\n════════════════════════════════════════════════════════`);
    console.log(` RESULTS — ${APPLY ? 'APPLIED' : 'DRY RUN'}`);
    console.log(`════════════════════════════════════════════════════════`);
    console.log(` grn_request rows inserted : ${inserted.toLocaleString()}`);
    console.log(` Skipped (already done)    : ${skipped.toLocaleString()}`);
    console.log(` Skipped (no branch map)   : ${branchMissCount}`);
    console.log(` Dup GRN# suffixed -id     : ${grnDupCount} (db_bill data quality issue)`);
    console.log(` vendor_payment_tracking   : ${vptInserted.toLocaleString()}`);
    console.log(` vendor_payment_transaction: ${vptxInserted.toLocaleString()}`);
    console.log('');
    console.log(' By type:');
    console.table(stats);
    console.log('');
    console.log(' By status:');
    console.table(statusCounts);

    if (headMissCount > 0) {
      console.log(`\n ⚠  ${headMissCount} rows had HeadId not found in tbl_bgt_expenseheadingmaster — raw HeadId stored as head text.`);
    }
    if (branchMissCount > 0) {
      console.log(`\n ⚠  ${branchMissCount} rows SKIPPED — BranchId not in grn_migration_branch_map:`);
      console.log(warnings.slice(0, 10).join('\n'));
      if (warnings.length > 10) console.log(`   ... and ${warnings.length - 10} more.`);
    }

    if (!APPLY) {
      console.log('\n DRY RUN complete — nothing written.');
      console.log(' Re-run with --apply to execute the migration.\n');
    } else {
      console.log('\n Migration complete.\n');
    }

  } finally {
    await hrms.end();
    await bill.end();
  }
}

// Helper: amount_without_tax, avoiding negative values for inclusive-tax entries
function amount_without_tax(amount: number, taxAmount: number): number {
  if (taxAmount === 0) return amount;
  return Math.max(0, amount - taxAmount);
}

main().catch(err => {
  console.error('\nMIGRATION FAILED:', err.message ?? err);
  process.exit(1);
});
