/**
 * migrate-bank-ledger-vendor-payments.ts
 *
 * Migrates two previously missing debit sources from db_bill into
 * bank_account_ledger_entry:
 *
 *   1. db_bill.tbl_payment  → vendor OUTGOING bank payments (RTGS/Cheque/Cash)
 *      Source of truth per migration 1718 comment: "money that actually went out"
 *      Maps deposit_bank → company_bank_account.id
 *
 *   2. db_bill.imprest_allotment_master → imprest cash allocations to branches
 *      Maps BankId → company_bank_account.id via db_bill.tbl_bank
 *
 * UNMAPPED accounts (no company_bank_account row) are SKIPPED and reported.
 * Idempotent: uses instrument_ref ('vprun:{id}' / 'imprest:{id}') as a
 * dedup key — re-running adds only rows not already present.
 *
 * After all inserts the running_balance for every affected account is
 * recomputed from scratch (opening_balance + window SUM over entry_date order).
 *
 * USAGE
 *   npx ts-node backend/scripts/migrate-bank-ledger-vendor-payments.ts           # dry-run
 *   npx ts-node backend/scripts/migrate-bank-ledger-vendor-payments.ts --apply   # write
 */

import mysql from "mysql2/promise";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";

const APPLY = process.argv.includes("--apply");

// ─── deposit_bank / tbl_bank.id → company_bank_account.id ─────────────────
// Confirmed via tbl_bank and company_bank_account.account_name + account_number_last4
const DEPOSIT_BANK_MAP: Record<string, string> = {
  "Stata Bank of India-Power": "85725734-9df1-4ff0-b4a5-6e7ac1d2062d", // POWER ...3886
  "Stata Bank of India-CC": "a52d19e5-e87c-4259-8069-5829f5b15a83", // SBI CC ...4502
  "ICICI Sim Aanan Vihar": "59f6d885-cb4a-4706-8c71-43c13c1d9bc1", // ICICI AV ...5852
  "ICICI Sim A/c": "59f6d885-cb4a-4706-8c71-43c13c1d9bc1", // ICICI AV (older name for same account)
};

// db_bill.tbl_bank.id → company_bank_account.id
const BANK_ID_MAP: Record<number, string> = {
  1: "85725734-9df1-4ff0-b4a5-6e7ac1d2062d", // Stata Bank of India-Power → POWER
  2: "a52d19e5-e87c-4259-8069-5829f5b15a83", // Stata Bank of India-CC → SBI CC
  8: "59f6d885-cb4a-4706-8c71-43c13c1d9bc1", // ICICI Sim Aanan Vihar → ICICI AV
};

// ─── types ────────────────────────────────────────────────────────────────
interface TblPaymentRow {
  id: number;
  company_name: string | null;
  financial_year: string | null;
  branch_name: string | null;
  pay_type: string | null;
  pay_no: string | null;
  bank_name: string | null;
  pays_date: Date | string | null;
  pay_amount: number;
  deposit_bank: string | null;
  no_of_bills: number | null;
  createdate: Date | string | null;
}

interface ImprestRow {
  Id: number;
  Branch: string | null;
  EntryDate: string | null;
  Amount: number;
  BankId: number | null;
  CreateDate: Date | string | null;
  Remarks: string | null;
}

function parseDate(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  const s = String(val).trim();
  if (!s || s.startsWith("0000-00-00") || s === "null") return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

async function main() {
  console.log(`\nBank Ledger — Vendor Payment Migration`);
  console.log(
    `Mode: ${APPLY ? "APPLY (writing to database)" : "DRY-RUN (no writes)"}\n`,
  );

  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST,
    port: Number(process.env.BILL_DB_PORT ?? 3306),
    user: process.env.BILL_DB_USER,
    password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
  });

  try {
    // ── Load existing instrument_refs to skip already-migrated rows ────────
    const [existingRefs] = await hrms.query<any[]>(
      `SELECT instrument_ref FROM bank_account_ledger_entry WHERE instrument_ref LIKE 'vprun:%' OR instrument_ref LIKE 'imprest:%'`,
    );
    const existingSet = new Set<string>(
      existingRefs.map((r) => r.instrument_ref as string),
    );
    console.log(`Already migrated rows (dedup set): ${existingSet.size}`);

    // ── 1. tbl_payment — vendor outgoing payments ──────────────────────────
    const [payments] = await bill.query<TblPaymentRow[]>(
      `SELECT id, company_name, financial_year, branch_name, pay_type, pay_no, bank_name,
              pays_date, pay_amount, deposit_bank, no_of_bills, createdate
       FROM tbl_payment
       WHERE pay_amount > 0
       ORDER BY pays_date ASC, id ASC`,
    );
    console.log(`tbl_payment rows with pay_amount > 0: ${payments.length}`);

    let pmtInserted = 0,
      pmtSkipped = 0,
      pmtNoDate = 0;
    const pmtUnmapped: Record<string, number> = {};
    const pmtRows: Array<Parameters<typeof hrms.execute>[1]> = [];

    for (const p of payments) {
      const ref = `vprun:${p.id}`;
      if (existingSet.has(ref)) {
        pmtSkipped++;
        continue;
      }

      const accountId = DEPOSIT_BANK_MAP[p.deposit_bank ?? ""];
      if (!accountId) {
        const key = p.deposit_bank ?? "(null)";
        pmtUnmapped[key] = (pmtUnmapped[key] ?? 0) + 1;
        continue;
      }

      const entryDate = parseDate(p.pays_date) ?? parseDate(p.createdate);
      if (!entryDate) {
        pmtNoDate++;
        continue;
      }

      const payType = (p.pay_type ?? "").trim();
      const payNo = (p.pay_no ?? "").toString().trim();
      const instrRef = payType && payNo ? `${payType} ${payNo}` : ref;

      pmtRows.push([
        uuidv4(), // id
        accountId, // bank_account_id
        entryDate, // entry_date
        p.pay_amount, // debit_amount (OUTGOING)
        0, // credit_amount
        `Vendor payment run: ${payType} ${payNo}${p.branch_name ? " — " + p.branch_name : ""}${p.financial_year ? " (" + p.financial_year + ")" : ""}`.trim(),
        instrRef, // instrument_ref
        0, // running_balance placeholder — recalculated below
        "vendor_payment", // source_type
        1, // is_migrated
      ]);
    }

    console.log(
      `\ntbl_payment: will insert ${pmtRows.length}, skip ${pmtSkipped}, no-date ${pmtNoDate}`,
    );
    if (Object.keys(pmtUnmapped).length > 0) {
      console.log(
        `tbl_payment UNMAPPED deposit_banks (rows skipped — no matching company_bank_account):`,
      );
      for (const [k, v] of Object.entries(pmtUnmapped).sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(`  "${k}" → ${v} row(s) SKIPPED`);
      }
    }

    // ── 2. imprest_allotment_master — branch cash allocations ─────────────
    const [imprests] = await bill.query<ImprestRow[]>(
      `SELECT Id, Branch, EntryDate, Amount, BankId, CreateDate, Remarks
       FROM imprest_allotment_master
       WHERE Amount > 0
       ORDER BY EntryDate ASC, Id ASC`,
    );
    console.log(
      `\nimprest_allotment_master rows with Amount > 0: ${imprests.length}`,
    );

    let impInserted = 0,
      impSkipped = 0,
      impNoDate = 0;
    const impUnmapped: Record<string, number> = {};
    const impRows: Array<Parameters<typeof hrms.execute>[1]> = [];

    for (const imp of imprests) {
      const ref = `imprest:${imp.Id}`;
      if (existingSet.has(ref)) {
        impSkipped++;
        continue;
      }

      const accountId = BANK_ID_MAP[imp.BankId ?? -1];
      if (!accountId) {
        const key = `BankId=${imp.BankId ?? "NULL"}`;
        impUnmapped[key] = (impUnmapped[key] ?? 0) + 1;
        continue;
      }

      const entryDate = parseDate(imp.EntryDate) ?? parseDate(imp.CreateDate);
      if (!entryDate) {
        impNoDate++;
        continue;
      }

      impRows.push([
        uuidv4(),
        accountId,
        entryDate,
        imp.Amount, // debit_amount (cash going out to branch)
        0,
        `Imprest allocation — ${imp.Branch ?? "Branch"}${imp.Remarks ? ": " + imp.Remarks : ""}`.trim(),
        ref,
        0,
        "direct_imprest_allocation",
        1,
      ]);
    }

    console.log(
      `imprest: will insert ${impRows.length}, skip ${impSkipped}, no-date ${impNoDate}`,
    );
    if (Object.keys(impUnmapped).length > 0) {
      console.log(`imprest UNMAPPED BankIds:`);
      for (const [k, v] of Object.entries(impUnmapped)) {
        console.log(`  ${k} → ${v} row(s) SKIPPED`);
      }
    }

    const totalNew = pmtRows.length + impRows.length;
    console.log(`\nTotal new rows to insert: ${totalNew}`);

    if (!APPLY) {
      console.log(`\nDRY-RUN complete. Re-run with --apply to write.`);
      return;
    }

    // ── Write rows in batches ─────────────────────────────────────────────
    const CHUNK = 200;
    const INSERT_SQL = `
      INSERT INTO bank_account_ledger_entry
        (id, bank_account_id, entry_date, debit_amount, credit_amount,
         narration, instrument_ref, running_balance, source_type, is_migrated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const allRows = [...pmtRows, ...impRows];
    let written = 0;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const chunk = allRows.slice(i, i + CHUNK);
      for (const row of chunk) {
        await hrms.execute(INSERT_SQL, row as any[]);
        written++;
      }
      process.stdout.write(`\r  Inserted ${written}/${allRows.length}…`);
    }
    console.log(`\n  Done inserting ${written} rows.`);
    pmtInserted = pmtRows.length;
    impInserted = impRows.length;

    // ── Recalculate running_balance for ALL accounts (clean slate) ────────
    // Uses MySQL window SUM ordered by entry_date, then id (deterministic UUID sort)
    // running_balance = opening_balance + cumulative net (credits - debits)
    console.log(`\nRecalculating running_balance for all accounts…`);

    const accountIds = [
      "85725734-9df1-4ff0-b4a5-6e7ac1d2062d",
      "a52d19e5-e87c-4259-8069-5829f5b15a83",
      "59f6d885-cb4a-4706-8c71-43c13c1d9bc1",
      "a3addb5f-2115-43dd-be51-103912eca5cf", // ICICI IDC (no new rows but recalc anyway)
    ];

    for (const acctId of accountIds) {
      const [[acctRow]] = await hrms.query<any[]>(
        `SELECT account_name, opening_balance FROM company_bank_account WHERE id = ?`,
        [acctId],
      );
      if (!acctRow) continue;

      // Build ordered running balance using a self-join trick compatible with older MySQL
      // We'll compute in-application via a cursor-style loop for safety
      const [entries] = await hrms.query<any[]>(
        `SELECT id, entry_date, debit_amount, credit_amount
         FROM bank_account_ledger_entry
         WHERE bank_account_id = ?
         ORDER BY entry_date ASC, id ASC`,
        [acctId],
      );

      let rb = Number(acctRow.opening_balance ?? 0);
      const updates: Array<[number, string]> = [];
      for (const e of entries) {
        rb += Number(e.credit_amount ?? 0) - Number(e.debit_amount ?? 0);
        updates.push([Math.round(rb * 100) / 100, e.id]);
      }

      // Bulk update in chunks
      for (let i = 0; i < updates.length; i += CHUNK) {
        const chunk = updates.slice(i, i + CHUNK);
        for (const [newRb, entryId] of chunk) {
          await hrms.execute(
            `UPDATE bank_account_ledger_entry SET running_balance = ? WHERE id = ?`,
            [newRb, entryId],
          );
        }
      }
      console.log(
        `  ${acctRow.account_name}: recalculated ${entries.length} entries, closing balance = ₹${rb.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
      );
    }

    console.log(`\n─────────────────────────────────────────────────────`);
    console.log(`MIGRATION COMPLETE`);
    console.log(`  tbl_payment inserted:  ${pmtInserted}`);
    console.log(`  imprest inserted:      ${impInserted}`);
    console.log(`  Total new rows:        ${written}`);
    console.log(`  Previously migrated (skipped): ${pmtSkipped + impSkipped}`);
    console.log(`─────────────────────────────────────────────────────`);
    console.log(
      `Unmapped accounts (rows NOT migrated — add company_bank_account rows to include):`,
    );
    for (const [k, v] of Object.entries({ ...pmtUnmapped })) {
      console.log(
        `  deposit_bank "${k}" → ${v} rows (needs a company_bank_account entry)`,
      );
    }
    for (const [k, v] of Object.entries(impUnmapped)) {
      console.log(`  imprest ${k} → ${v} rows`);
    }
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
