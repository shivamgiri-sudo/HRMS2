/**
 * One-time remediation: 58 real, live vendor GRNs (Aug–Sep 2026, Rs 11,34,831.51 combined,
 * excludes one unrelated 2018 legacy row with a broken vendor mapping) were left stuck at
 * status='finance_head_approved' with no vendor_payment_tracking row, ever — the "at least one
 * vendor GRN payment record must be selected" error a user hit live on the Payment Vouchers
 * page traces directly to this: nothing was ever selectable, because these GRNs never became
 * payable.
 *
 * Root cause, confirmed against the live DB and the codebase: backfill-vendor-grn-approved-
 * status.cjs (an earlier one-time migration script) set status='finance_head_approved' on
 * these rows via a raw UPDATE, bypassing grn-smart.service.ts's review() entirely — the ONLY
 * code path that calls vendorPaymentService.createFromGrn() to actually create the payable
 * record. No TypeScript code anywhere in this repo sets that status; it only exists as a guard
 * value and a cancelGrn() block-list entry. These 58 rows have real grn_numbers (assigned by
 * the same backfill) but finance_head_reviewed_at is NULL on every one of them — proof they
 * never went through the real review flow.
 *
 * Separately (not what's being fixed here — see grn-validation-control.service.ts's new
 * VENDOR_INVOICE_ATTACHMENT check): all 58 also lack an invoice/supporting attachment, which
 * createFromGrn() has always hard-required. That check is correct and stays; this script is a
 * one-time, reasoned, audited exception for exactly this pre-existing backlog (via
 * createFromGrn's new optional remediationReason param — see vendor-payment.service.ts), not a
 * general bypass. Nothing about this script changes how any GRN behaves going forward.
 *
 * Scope: grn_request rows where grn_type='vendor', status='finance_head_approved',
 * vendor_id/vendor_name are set (excludes the one broken 2018 row), created_at >= 2026-01-01.
 *
 * For each: calls the exact same INSERT INTO vendor_payment_tracking createFromGrn() runs
 * (kept in sync with that function's field list by hand — this is a one-time script, not a
 * permanent duplicate of it), then the same status='pending_accounts_payment' UPDATE
 * createFromGrn() makes on success, so these rows end up in the identical state a normal live
 * approval would have left them in. Idempotent: skips any GRN that already has a
 * vendor_payment_tracking row (re-running after a partial apply is safe).
 *
 * Saves the full before-state to a JSON file before writing, so the change is reversible by id
 * list.
 *
 * USAGE
 *   node backend/scripts/remediate-attachmentless-approved-vendor-grn-backlog.mjs            # dry-run
 *   node backend/scripts/remediate-attachmentless-approved-vendor-grn-backlog.mjs --apply     # write
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const REMEDIATION_REASON =
  "Backlog remediation 2026-09-11: backfill-vendor-grn-approved-status.cjs set status directly " +
  "and never called createFromGrn(); no attachment was ever collected for these pre-2026-09-11 " +
  "GRNs because the requirement did not exist yet at their approval time. See " +
  "remediate-attachmentless-approved-vendor-grn-backlog.mjs.";
const OUT_FILE = path.join(__dirname, `remediate-grn-backlog-${Date.now()}.json`);
// finance_action_audit_log.actor_user_id is NOT NULL — this remediation was requested and
// authorized directly by Shivam Giri (shivam.giri@teammas.in), so the audit trail attributes
// it to the actual accountable person rather than a null/system placeholder.
const ACTOR_USER_ID = 'a4a4902e-6222-11f1-adb1-00155d0ab410';

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [candidates] = await conn.execute(
    `SELECT g.*
       FROM grn_request g
       LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = g.id
      WHERE g.grn_type = 'vendor'
        AND g.status = 'finance_head_approved'
        AND g.vendor_id IS NOT NULL
        AND g.vendor_name IS NOT NULL
        AND g.created_at >= '2026-01-01'
        AND vpt.id IS NULL
      ORDER BY g.created_at ASC`,
  );

  console.log(`Found ${candidates.length} candidate GRN(s).`);
  if (candidates.length === 0) {
    console.log('Nothing to do.');
    await conn.end();
    return;
  }

  const beforeState = candidates.map((g) => ({
    id: g.id,
    grn_number: g.grn_number,
    vendor_name: g.vendor_name,
    amount_with_tax: g.amount_with_tax,
    status: g.status,
  }));
  fs.writeFileSync(OUT_FILE, JSON.stringify(beforeState, null, 2));
  console.log(`Before-state saved: ${OUT_FILE}`);

  let totalAmount = 0;
  for (const grn of candidates) {
    const dueAmount = roundMoney(Number(grn.amount_with_tax ?? grn.amount ?? 0));
    totalAmount += dueAmount;
    console.log(
      `${APPLY ? 'REMEDIATING' : '[dry-run]'} ${grn.grn_number ?? grn.id} — ${grn.vendor_name} — Rs${dueAmount.toFixed(2)}`,
    );
    if (!APPLY) continue;

    if (dueAmount <= 0) {
      console.log(`  SKIPPED — non-positive amount`);
      continue;
    }

    await conn.beginTransaction();
    try {
      const id = randomUUID();
      await conn.execute(
        `INSERT INTO vendor_payment_tracking
           (id, grn_request_id, grn_number, branch_id, process_id, cost_centre_id,
            cost_class, vendor_id, vendor_name, head, sub_head, due_amount, due_date,
            grn_file_name, grn_file_path, grn_file_mime, paid_amount, balance_amount,
            payment_status, financial_year, budget_id, budget_line_id,
            amount_without_tax, tax_amount, amount_with_tax)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'Payment Pending',?,?,?,?,?,?)`,
        [
          id,
          grn.id,
          grn.grn_number,
          grn.branch_id,
          grn.process_id ?? null,
          grn.cost_centre_id ?? null,
          grn.cost_class ?? 'indirect',
          grn.vendor_id,
          grn.vendor_name,
          grn.head,
          grn.sub_head,
          dueAmount,
          grn.due_date ?? grn.bill_date,
          grn.attachment_original_name ?? grn.attachment_file_name,
          grn.attachment_path ?? grn.attachment_file_path,
          grn.attachment_mime ?? grn.attachment_file_mime,
          dueAmount,
          grn.financial_year ?? null,
          grn.budget_id ?? null,
          grn.budget_line_id ?? null,
          Number(grn.amount_without_tax || grn.amount || 0),
          Number(grn.tax_amount || 0),
          dueAmount,
        ],
      );
      await conn.execute(
        `UPDATE grn_request SET status = 'pending_accounts_payment', accounts_payment_status = 'pending' WHERE id = ?`,
        [grn.id],
      );
      await conn.execute(
        `INSERT INTO finance_action_audit_log
           (id, action_type, entity_type, entity_id, actor_user_id, actor_role, change_summary, created_at)
         VALUES (?, 'VENDOR_PAYMENT_ROW_CREATED_WITHOUT_ATTACHMENT', 'VENDOR_PAYMENT', ?, ?, 'system_remediation', ?, NOW())`,
        [
          randomUUID(),
          id,
          ACTOR_USER_ID,
          JSON.stringify({
            grn_id: grn.id,
            grn_number: grn.grn_number,
            due_amount: dueAmount,
            reason: REMEDIATION_REASON,
          }),
        ],
      );
      await conn.commit();
      console.log(`  OK — vendor_payment_tracking ${id}`);
    } catch (err) {
      await conn.rollback();
      console.error(`  FAILED: ${err.message}`);
    }
  }

  console.log(`\nTotal ${APPLY ? 'remediated' : 'would remediate'}: Rs${totalAmount.toFixed(2)}`);
  if (!APPLY) console.log('Dry run only — re-run with --apply to write.');
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
