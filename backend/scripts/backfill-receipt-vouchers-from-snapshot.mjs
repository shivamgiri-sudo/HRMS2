/**
 * backfill-receipt-vouchers-from-snapshot.mjs
 *
 * Converts client_bill_collection_run_snapshot (6,315 historical client payment runs
 * from db_bill) into payment_voucher + bank_account_ledger_entry rows so the bank
 * ledger shows the real historical received amounts.
 *
 * DRY-RUN by default. Pass --execute to actually insert rows.
 * Pass --limit=N to process only the first N rows (for testing).
 *
 * Run: cd backend && node scripts/backfill-receipt-vouchers-from-snapshot.mjs
 * Run: cd backend && node scripts/backfill-receipt-vouchers-from-snapshot.mjs --execute
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { randomUUID } from "crypto";

const EXECUTE = process.argv.includes("--execute");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : null;

function stripQuotes(v) {
  return (v ?? "").replace(/^["']|["']$/g, "");
}

const cfg = {
  host: stripQuotes(process.env.DB_HOST ?? "localhost"),
  user: stripQuotes(process.env.DB_USER ?? "root"),
  password: stripQuotes(process.env.DB_PASSWORD ?? ""),
  database: stripQuotes(process.env.DB_NAME ?? "mas_hrms"),
  connectTimeout: 10000,
};

// Known mapping from db_bill deposit_bank names → company_bank_account.account_name fragments.
// The script will resolve these against live company_bank_account rows and print any
// unmatched deposit_bank names for manual review before inserting.
const DEPOSIT_BANK_HINT = {
  "Stata Bank of India-Power": "Power",
  "Stata Bank of India-CC": "CC",
  "Stata Bank of India-IDC CC": "IDC CC",
  "ICICI Sim Aanan Vihar": "Aanan Vihar",
  "Stata Bank of India-IDC Current": "IDC Current",
  "RTGS": "RTGS",
  "ICICI Sim A/c": "ICICI Sim A",
  "ICICI Sim Credit Max": "Credit Max",
  "Stata Bank of India-Dial Desk": "Dial Desk",
};

async function main() {
  const conn = await mysql.createConnection(cfg);
  console.log(`[backfill] Connected to ${cfg.host}/${cfg.database}`);
  console.log(`[backfill] Mode: ${EXECUTE ? "EXECUTE (will write rows)" : "DRY-RUN (no writes)"}`);

  // 1. Load company_bank_account list to build deposit_bank → id map
  const [accounts] = await conn.query("SELECT id, account_name FROM company_bank_account WHERE active_status = 1");
  console.log(`[backfill] ${accounts.length} active company_bank_account rows`);

  // Resolve deposit_bank → company_bank_account.id
  const bankMap = new Map(); // deposit_bank_name → company_bank_account.id
  for (const [depositBankName, hint] of Object.entries(DEPOSIT_BANK_HINT)) {
    const match = accounts.find((a) =>
      a.account_name.toLowerCase().includes(hint.toLowerCase())
    );
    if (match) {
      bankMap.set(depositBankName, match.id);
      console.log(`  ✓ "${depositBankName}" → "${match.account_name}" (${match.id.slice(0, 8)})`);
    } else {
      console.warn(`  ✗ "${depositBankName}" → NO MATCH — rows with this deposit_bank will be SKIPPED`);
    }
  }

  // 2. Load a receivable payable_account_master row for receipts
  const [[receivableAccount]] = await conn.query(
    `SELECT id FROM payable_account_master WHERE account_type = 'receivable' AND active_status = 1 LIMIT 1`
  );
  if (!receivableAccount) {
    console.error("[backfill] No active receivable payable_account_master row found. Add one (e.g. 'Sundry Debtors') before running this script.");
    process.exit(1);
  }
  const receivableAccountId = receivableAccount.id;
  console.log(`[backfill] Using payable_account_master id=${receivableAccountId.slice(0, 8)} for all receipt ledger heads`);

  // 3. Load snapshot rows ordered by pay_date ASC (so running balance accumulates correctly)
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : "";
  const [snapshotRows] = await conn.query(
    `SELECT id, bill_source_id, company_name, financial_year, branch_name,
            pay_type, pay_no, bank_name, pay_date, pay_amount, deposit_bank,
            raised_by, payment_file, is_approved, source_created_at
       FROM client_bill_collection_run_snapshot
      ORDER BY pay_date ASC, id ASC
      ${limitClause}`
  );
  console.log(`[backfill] ${snapshotRows.length} snapshot rows to process`);

  // 4. Check existing backfilled rows (idempotent — use bill_source_id as external ref in narration)
  const [existingRows] = await conn.query(
    `SELECT narration FROM bank_account_ledger_entry WHERE source_type = 'backfill_receipt'`
  );
  const existingRefs = new Set(existingRows.map((r) => r.narration));
  console.log(`[backfill] ${existingRefs.size} rows already backfilled (will skip duplicates)`);

  // 5. Track running balance per bank account
  const runningBalances = new Map(); // company_bank_account.id → number

  // Pre-load existing last balances
  for (const [, accountId] of bankMap) {
    const [[last]] = await conn.query(
      `SELECT running_balance FROM bank_account_ledger_entry WHERE bank_account_id = ? ORDER BY entry_date ASC, id ASC LIMIT 1`,
      [accountId]
    );
    // Start from 0 if no prior entries (opening balance is handled separately via company_bank_account.opening_balance)
    const [[acct]] = await conn.query(`SELECT opening_balance FROM company_bank_account WHERE id = ? LIMIT 1`, [accountId]);
    runningBalances.set(accountId, last ? Number(last.running_balance) - Number(acct?.opening_balance ?? 0) : 0);
  }
  // Reset to opening_balance as starting point for backfill (backfill goes first chronologically)
  for (const [, accountId] of bankMap) {
    const [[acct]] = await conn.query(`SELECT opening_balance FROM company_bank_account WHERE id = ? LIMIT 1`, [accountId]);
    runningBalances.set(accountId, Number(acct?.opening_balance ?? 0));
  }

  let inserted = 0, skipped = 0, unmapped = 0;

  for (const row of snapshotRows) {
    const accountId = bankMap.get(row.deposit_bank);
    if (!accountId) { unmapped++; continue; }

    const narrationRef = `BACKFILL:snapshot_id=${row.id}`;
    if (existingRefs.has(narrationRef)) { skipped++; continue; }

    const amount = Math.round(Number(row.pay_amount ?? 0) * 100) / 100;
    if (amount <= 0) { skipped++; continue; }

    const payDate = row.pay_date ? new Date(row.pay_date).toISOString().slice(0, 10) : new Date(row.source_created_at).toISOString().slice(0, 10);
    const prior = runningBalances.get(accountId) ?? 0;
    const newBalance = Math.round((prior + amount) * 100) / 100;
    runningBalances.set(accountId, newBalance);

    const voucherId = randomUUID();
    const ledgerId = randomUUID();
    const yyyymm = payDate.slice(0, 7).replace("-", "");
    const voucherNumber = `RV/BACKFILL/${yyyymm}/${String(row.bill_source_id).padStart(6, "0")}`;

    if (EXECUTE) {
      try {
        await conn.beginTransaction();

        await conn.execute(
          `INSERT INTO payment_voucher
             (id, voucher_number, voucher_type, source_type, bank_account_id, payable_account_id,
              amount, particulars, remarks, status,
              raised_by, ceo_approved_by, released_by,
              raised_at, ceo_approved_at, released_at)
           VALUES (?, ?, 'receipt', 'sales_receipt', ?, ?, ?, ?, ?, 'released',
                   'system_backfill', 'system_backfill', 'system_backfill',
                   ?, ?, ?)`,
          [
            voucherId, voucherNumber, accountId, receivableAccountId,
            amount,
            row.company_name ?? row.branch_name ?? "Client receipt (migrated)",
            `${row.pay_type ?? ""} ${row.pay_no ?? ""} — ${row.deposit_bank}`.trim(),
            payDate, payDate, payDate,
          ]
        );

        await conn.execute(
          `INSERT INTO bank_account_ledger_entry
             (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
              payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'backfill_receipt', 'system_backfill')`,
          [
            ledgerId, accountId, payDate, voucherId,
            amount, receivableAccountId,
            narrationRef,
            row.pay_type ?? null,
            newBalance,
          ]
        );

        await conn.commit();
        inserted++;
      } catch (e) {
        await conn.rollback();
        console.error(`[backfill] ERROR on snapshot_id=${row.id}:`, e.message);
      }
    } else {
      // Dry run — just count
      inserted++;
      if (inserted <= 5) {
        console.log(`  [DRY-RUN] Would insert: voucher=${voucherNumber} amount=₹${amount} date=${payDate} bank=${row.deposit_bank} balance_after=₹${newBalance}`);
      }
    }
  }

  console.log(`\n[backfill] Done. inserted=${inserted} skipped=${skipped} unmapped=${unmapped}`);
  if (!EXECUTE) console.log("[backfill] DRY RUN complete — re-run with --execute to commit rows");

  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
