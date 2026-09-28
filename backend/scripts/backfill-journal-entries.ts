/**
 * Phase 6 — one-time backfill of journal_entry rows for GRNs approved and Payment Vouchers
 * released BEFORE Journal Task 2/3's wiring went live. Without this, Task 4's Trial Balance and
 * Vendor Ledger only ever show activity from go-live forward (see ledger-reports's own "as-of
 * caveat"). Read-only unless run with --apply.
 *
 * TWO PASSES, run independently (either can be re-run safely — both skip anything that already
 * has a live journal_entry):
 *
 *   --grn      Re-derives each un-journaled GRN's entry via postGrnApprovalJournalEntry() —
 *              the EXACT same function Journal Task 2 calls live, so a backfilled GRN's journal
 *              entry is byte-for-byte what it would have posted at approval time. Safe to trust
 *              fully; this is not a reconstruction, it's the same code path run late.
 *
 *   --vouchers Cannot reuse release()'s own code the same way — re-running it would re-invoke
 *              vendorPaymentLedgerService.dispatch(), which has real side effects (writes a NEW
 *              vendor_payment_transaction row, moves vendor_payment_tracking balances again).
 *              Running it a second time for history would corrupt live vendor balances. Instead
 *              this reconstructs from what release() ALREADY wrote at the time:
 *                - the cash leg is exact: bank_account_ledger_entry rows for the voucher, where
 *                  debit_amount > 0, give the precise net amount that left the bank, to the paisa.
 *                - the vendor is resolved the same way Task 3 does live: via
 *                  payment_voucher_grn_allocation (or the single linked_vendor_payment_id
 *                  fallback) joined to vendor_payment_tracking.vendor_id.
 *                - TDS is resolved the same way tally-export.service.ts's own fetchVoucherRows()
 *                  already does for the SAME reconstruction problem: SUM(vendor_payment_tracking
 *                  .tds_deducted_amount) across this voucher's GRN allocations. That column is
 *                  cumulative on the tracking row (total TDS ever deducted against that GRN, not
 *                  per-installment), so a GRN paid across several separate vouchers will have its
 *                  full cumulative TDS attributed to EACH backfilled voucher that touched it —
 *                  the same known approximation tally-export.service.ts's export already makes
 *                  silently today. This script does not silently accept that: it reports every
 *                  voucher where a GRN allocation was shared with another voucher, so a human can
 *                  judge whether the approximation matters for that specific case before trusting
 *                  the backfilled figure.
 *
 * Usage:
 *   npx tsx backend/scripts/backfill-journal-entries.ts --grn                 (dry run, GRNs only)
 *   npx tsx backend/scripts/backfill-journal-entries.ts --grn --apply         (applies)
 *   npx tsx backend/scripts/backfill-journal-entries.ts --vouchers --apply
 *   npx tsx backend/scripts/backfill-journal-entries.ts --grn --vouchers --apply   (both)
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { postGrnApprovalJournalEntry } from "../src/modules/finance/grn-journal-posting.service.js";
import { journalService } from "../src/modules/finance/journal.service.js";
import { vendorGrnLines, vendorAdvanceLines, imprestAllocationLines, generalLines } from "../src/modules/finance/payment-voucher-journal-lines.js";

const APPLY = process.argv.includes("--apply");
const DO_GRN = process.argv.includes("--grn");
const DO_VOUCHERS = process.argv.includes("--vouchers");

const CONSUMED_GRN_STATUSES = ["pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "approved"];

/**
 * postGrnApprovalJournalEntry() defaults entryDate to today — correct for the live approval
 * path, wrong here: without an explicit override every one of thousands of historical entries
 * would be stamped with the backfill run's date instead of when the GRN was actually approved,
 * corrupting the Trial Balance's date view. finance_head_reviewed_at is the exact moment this
 * function models ("at GRN approval"); bill_date and created_at are fallbacks for the ~30% of
 * historical rows (legacy db_bill-migrated, before this column existed) that don't have it.
 */
function historicalEntryDate(grn: any): string {
  // Pool is created with dateStrings: true (see main()), so these arrive as plain
  // "YYYY-MM-DD..." strings already in the server's wall-clock value — a straight slice, no
  // Date object round-trip that could shift the calendar day via a UTC conversion.
  const raw: string = grn.finance_head_reviewed_at ?? grn.bill_date ?? grn.created_at;
  return raw.slice(0, 10);
}

async function backfillGrns(pool: mysql.Pool) {
  const [grns] = await pool.query<any[]>(
    `SELECT g.* FROM grn_request g
      WHERE g.status IN (${CONSUMED_GRN_STATUSES.map(() => "?").join(",")})
        AND NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type = 'grn' AND je.source_id = g.id)`,
    CONSUMED_GRN_STATUSES,
  );

  console.log(`\n=== GRN backfill: ${(grns as any[]).length} candidate(s) ===\n`);
  let posted = 0;
  const failures: { grnNumber: string; error: string }[] = [];

  for (const grn of grns as any[]) {
    if (!APPLY) { console.log(`  [dry run] would post journal entry for GRN ${grn.grn_number ?? grn.id}`); continue; }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await postGrnApprovalJournalEntry(connection, grn, "backfill-script", historicalEntryDate(grn));
      await connection.commit();
      posted++;
      console.log(`  posted GRN ${grn.grn_number ?? grn.id}`);
    } catch (err: any) {
      await connection.rollback();
      failures.push({ grnNumber: grn.grn_number ?? grn.id, error: err.message ?? String(err) });
      console.error(`  FAILED GRN ${grn.grn_number ?? grn.id}: ${err.message ?? err}`);
    } finally {
      connection.release();
    }
  }

  console.log(`\nGRN backfill: ${posted} posted, ${failures.length} failed.`);
  if (failures.length) {
    console.log(`Failures need manual attention (most likely EXPENSE_LEDGER_NOT_FOUND — run verify-head-subhead-ledger-coverage.ts):`);
    for (const f of failures) console.log(`  ${f.grnNumber}: ${f.error}`);
  }
}

async function backfillVouchers(pool: mysql.Pool) {
  const [vouchers] = await pool.query<any[]>(
    `SELECT v.* FROM payment_voucher v
      WHERE v.status = 'released'
        AND NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type = 'payment_voucher' AND je.source_id = v.id)`,
  );

  console.log(`\n=== Payment Voucher backfill: ${(vouchers as any[]).length} candidate(s) ===\n`);
  let posted = 0;
  const sharedAllocationWarnings: { voucherNumber: string; grnId: string }[] = [];
  const failures: { voucherNumber: string; error: string }[] = [];

  for (const v of vouchers as any[]) {
    const lines: import("../src/modules/finance/journal.service.js").JournalLineInput[] = [];

    if (v.source_type === "vendor_grn") {
      const [allocRows] = await pool.query<any[]>(
        `SELECT ga.vendor_payment_tracking_id, ga.allocated_amount,
                vpt.vendor_id, vpt.grn_request_id, vpt.tds_deducted_amount
           FROM payment_voucher_grn_allocation ga
           JOIN vendor_payment_tracking vpt ON vpt.id = ga.vendor_payment_tracking_id
          WHERE ga.payment_voucher_id = ?`,
        [v.id],
      );
      const allocations = (allocRows as any[]).length
        ? (allocRows as any[]).map((r) => ({
            vendorId: r.vendor_id, grnId: r.grn_request_id,
            amount: Number(r.allocated_amount), tds: Number(r.tds_deducted_amount ?? 0),
          }))
        : await (async () => {
            const [[vpt]] = await pool.query<any[]>(
              `SELECT vendor_id, grn_request_id, tds_deducted_amount FROM vendor_payment_tracking WHERE id = ?`,
              [v.linked_vendor_payment_id],
            );
            return vpt
              ? [{ vendorId: (vpt as any).vendor_id, grnId: (vpt as any).grn_request_id, amount: Number(v.amount), tds: Number((vpt as any).tds_deducted_amount ?? 0) }]
              : [];
          })();

      // A GRN allocated to more than one voucher (partial/installment payments) means
      // tds_deducted_amount — cumulative on vendor_payment_tracking, not per-installment — would
      // be attributed in full to each voucher that touched it. Same approximation
      // tally-export.service.ts's own fetchVoucherRows() already makes; reported, not hidden.
      for (const a of allocations) {
        const [[{ n }]] = await pool.query<any[]>(
          `SELECT COUNT(DISTINCT payment_voucher_id) AS n FROM payment_voucher_grn_allocation
            WHERE vendor_payment_tracking_id IN (SELECT id FROM vendor_payment_tracking WHERE grn_request_id = ?)`,
          [a.grnId],
        );
        if (Number(n) > 1) sharedAllocationWarnings.push({ voucherNumber: v.voucher_number ?? v.id, grnId: a.grnId });
      }

      let tdsPayableAccountId: string | null = null;
      for (const a of allocations) {
        if (a.tds > 0 && tdsPayableAccountId === null) {
          const [[row]] = await pool.query<any[]>(`SELECT id FROM payable_account_master WHERE account_name = 'TDS Payable' LIMIT 1`);
          tdsPayableAccountId = row ? String((row as any).id) : "";
        }
        lines.push(
          ...vendorGrnLines({
            vendorId: a.vendorId, bankAccountId: v.bank_account_id,
            netAmount: a.amount, tdsAmount: a.tds,
            tdsPayableAccountId: a.tds > 0 ? tdsPayableAccountId : null,
          }),
        );
      }
    } else if (v.source_type === "vendor_advance") {
      lines.push(...vendorAdvanceLines({ vendorId: v.linked_vendor_id, bankAccountId: v.bank_account_id, amount: Number(v.amount) }));
    } else if (v.source_type === "imprest_allocation") {
      lines.push(...imprestAllocationLines({ imprestFloatAccountId: v.payable_account_id, bankAccountId: v.bank_account_id, amount: Number(v.amount) }));
    } else if (v.source_type === "vendor_advance_application") {
      // No cash leg at all historically (Adjustment mode) and no persisted TDS figure to
      // reconstruct — genuinely nothing safe to backfill for this lane. Skipped, not failed.
      continue;
    } else {
      lines.push(...generalLines({ payableAccountId: v.payable_account_id, bankAccountId: v.bank_account_id, amount: Number(v.amount) }));
    }

    if (lines.length === 0) continue;

    if (!APPLY) { console.log(`  [dry run] would post journal entry for voucher ${v.voucher_number ?? v.id} (${lines.length} lines)`); continue; }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await journalService.post(connection, {
        entryDate: v.payment_date ?? v.released_at ?? new Date().toISOString().slice(0, 10),
        narration: `Backfilled — Payment Voucher ${v.voucher_number ?? v.id} released (${v.source_type})`,
        sourceType: "payment_voucher",
        sourceId: v.id,
        postedBy: "backfill-script",
        lines,
      });
      await connection.commit();
      posted++;
      console.log(`  posted voucher ${v.voucher_number ?? v.id}`);
    } catch (err: any) {
      await connection.rollback();
      failures.push({ voucherNumber: v.voucher_number ?? v.id, error: err.message ?? String(err) });
      console.error(`  FAILED voucher ${v.voucher_number ?? v.id}: ${err.message ?? err}`);
    } finally {
      connection.release();
    }
  }

  console.log(`\nPayment Voucher backfill: ${posted} posted, ${failures.length} failed.`);
  if (sharedAllocationWarnings.length) {
    console.log(`\n${sharedAllocationWarnings.length} allocation(s) belong to a GRN that was also paid by ANOTHER voucher — TDS may be double-counted across them (see this script's header on why):`);
    for (const w of sharedAllocationWarnings) console.log(`  voucher ${w.voucherNumber}, GRN ${w.grnId}`);
    console.log(`Review these specifically — sum each affected GRN's TDS across every voucher that touched it and compare to vendor_payment_tracking.tds_deducted_amount; hand-correct with a reversing entry if it's actually double-counted.`);
  }
  if (failures.length) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ${f.voucherNumber}: ${f.error}`);
  }
}

async function main() {
  if (!DO_GRN && !DO_VOUCHERS) {
    console.log("Specify --grn and/or --vouchers. Add --apply to actually write (default is dry run).");
    process.exit(1);
  }
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    // Matches src/db/mysql.ts's own pool config. Without this, DATE/DATETIME columns come back
    // as JS Date objects in the driver's default (often UTC) interpretation — historicalEntryDate()
    // below would then silently shift any GRN approved before ~05:30 IST to the previous
    // calendar day once .toISOString() converts it. Live-caught 2026-09-17 before the backfill
    // ran, not after.
    dateStrings: true,
  });

  if (!APPLY) console.log("DRY RUN — no writes will be made. Pass --apply to actually post.");
  if (DO_GRN) await backfillGrns(pool);
  if (DO_VOUCHERS) await backfillVouchers(pool);

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
