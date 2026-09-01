/**
 * fix-imprest-missing-topups-from-dbbill.ts
 *
 * ONE-TIME correction for imprest top-up money that exists in db_bill's imprest_allotment_master
 * (the legacy per-manager top-up ledger) but was never migrated into HRMS2's
 * imprest_transaction_ledger. Found 2026-09-01 via a full per-manager, per-branch reconciliation
 * of all 39 db_bill managers with allotment history against all 42 HRMS2 imprest managers.
 *
 * SCOPE — exactly 2 of 3 real gaps found. The third (Manish Kumar, Rs 3,29,169) is deliberately
 * NOT touched here: db_bill records him only by name, and HRMS2's employees table has 150+
 * people named "Manish Kumar" — there is no reliable way to identify which one held this float
 * without a human who knows the branch's history confirming it. Guessing wrong would misattribute
 * real financial history to the wrong person, which is worse than leaving the gap open.
 *
 *   1. HO Imprest (HEAD OFFICE, existing HRMS2 manager) — short by Rs 2,000. Single adjustment
 *      credit; the manager already has an active record and extensive ledger history, this is
 *      the one round-number shortfall on top of it.
 *
 *   2. Sudeep Negi (Mayapuri, NO HRMS2 manager record exists at all) — Rs 1,91,946 across 44
 *      individual db_bill entries (2019-02-25 to 2020-01-27). Safe to identify: exactly one
 *      "SUDEEP NEGI" employee exists in HRMS2 (MAS01963, active, has a user_id). Creates the
 *      missing imprest_manager row (inactive, matching Mayapuri's own closed status — this is
 *      closing out old books, not reopening an active float) and posts all 44 entries
 *      individually, preserving db_bill's own dates/references/remarks, rather than one lump
 *      sum, so the ledger reads the same way every other migrated manager's history does.
 *
 * WHAT THIS DOES
 *   HO Imprest: posts one entryType='adjustment' credit of Rs 2,000 to the existing manager.
 *   Sudeep Negi: creates one imprest_manager row (if it does not already exist), then posts
 *   44 entryType='allocation' credits/debits (negative db_bill amounts become debits — several
 *   of his entries are corrections of an earlier mistaken entry, e.g. "wrongly updated" /
 *   "reversed"), each tagged referenceType='manual' with the original db_bill PaymentNo and
 *   remarks preserved in the narration.
 *
 * USAGE
 *   npx ts-node backend/scripts/fix-imprest-missing-topups-from-dbbill.ts           # dry-run
 *   npx ts-node backend/scripts/fix-imprest-missing-topups-from-dbbill.ts --apply   # write
 *
 * SAFE TO RE-RUN — checks for an existing imprest_manager row by employee_id before creating
 * one, and checks for an existing ledger entry with the same narration prefix before posting
 * a duplicate.
 */

import mysql from "mysql2/promise";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";

const APPLY = process.argv.includes("--apply");
const ACTOR_ID = "00000000-0000-0000-0000-dbbilltopup1"; // char(36)-fitting sentinel, distinct from other fix-*.ts scripts

const HO_IMPREST_MANAGER_ID = "44b81c66-40a8-4a17-b7f9-b113e86ab679";
const HO_SHORTFALL = 2000;

const SUDEEP_EMPLOYEE_ID = "0cf00cf6-5e8b-11f1-adb1-00155d0ab410";
const SUDEEP_USER_ID = "d98a0a9d-6d7b-4b1d-98a1-cc948fb09eea";
const MAYAPURI_BRANCH_ID = "feb3ff2d-6583-11f1-adb1-00155d0ab410";

async function writeAudit(conn: mysql.Connection, entityId: string, summary: Record<string, unknown>) {
  await conn.execute(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, actor_role, action_type, module_key,
        entity_type, entity_id, change_summary, acted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      uuidv4(), ACTOR_ID, "migration_script", "IMPREST_MISSING_TOPUP_BACKFILLED", "FINANCE",
      "imprest_manager", entityId, JSON.stringify(summary),
    ],
  );
}

async function postLedgerEntry(
  conn: mysql.Connection,
  managerId: string,
  branchId: string,
  entryType: string,
  direction: "credit" | "debit",
  amount: number,
  transactionDate: string,
  narration: string,
) {
  const [balRows] = await conn.query<any[]>(
    `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END),0) AS bal
       FROM imprest_transaction_ledger WHERE imprest_manager_id = ?`,
    [managerId],
  );
  const current = Number(balRows[0]?.bal ?? 0);
  const delta = direction === "credit" ? amount : -amount;
  const balanceAfter = Math.round((current + delta) * 100) / 100;

  await conn.execute(
    `INSERT INTO imprest_transaction_ledger
       (id, imprest_manager_id, branch_id, entry_type, direction, amount, balance_after,
        reference_type, reference_id, period_code, transaction_date, narration, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?, ?, ?, ?, NOW())`,
    [
      uuidv4(), managerId, branchId, entryType, direction, amount, balanceAfter,
      transactionDate.slice(0, 7), transactionDate, narration, ACTOR_ID,
    ],
  );
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    console.log("\n════════════════════════════════════════════════════════");
    console.log(" Imprest Missing Top-Ups (db_bill -> HRMS2) Correction");
    console.log("════════════════════════════════════════════════════════");
    console.log(` Mode: ${APPLY ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}\n`);

    console.log(" NOT in scope, deliberately: Manish Kumar Imprest (Mayapuri), Rs 3,29,169 —");
    console.log(" db_bill names him by name only; 150+ 'Manish Kumar' employees exist in HRMS2");
    console.log(" with no reliable way to pick the right one. Needs a human who knows this");
    console.log(" branch's history to identify him before anything can be posted.\n");

    // ── 1. HO Imprest: Rs 2,000 shortfall ───────────────────────────────────
    console.log(" [1/2] HO Imprest (HEAD OFFICE) — Rs 2,000 shortfall");
    const [existingHoAdj] = await conn.query<any[]>(
      `SELECT id FROM imprest_transaction_ledger
        WHERE imprest_manager_id = ? AND narration LIKE 'db_bill reconciliation 2026-09-01%'`,
      [HO_IMPREST_MANAGER_ID],
    );
    if (existingHoAdj.length) {
      console.log("   -> Already posted (found a prior matching entry). Skipping.");
    } else if (!APPLY) {
      console.log(`   -> Would post a Rs ${HO_SHORTFALL} credit adjustment.`);
    } else {
      const [mgrRow] = await conn.query<any[]>(`SELECT branch_id FROM imprest_manager WHERE id = ?`, [HO_IMPREST_MANAGER_ID]);
      if (!mgrRow[0]) {
        console.log("   -> SKIP: manager not found.");
      } else {
        await postLedgerEntry(
          conn, HO_IMPREST_MANAGER_ID, String(mgrRow[0].branch_id), "adjustment", "credit", HO_SHORTFALL,
          new Date().toISOString().slice(0, 10),
          "db_bill reconciliation 2026-09-01: HO Imprest's db_bill top-up total (Rs 2,00,823) "
          + "exceeded HRMS2's migrated total (Rs 1,98,823) by Rs 2,000 — posted to close the gap.",
        );
        await writeAudit(conn, HO_IMPREST_MANAGER_ID, { shortfall: HO_SHORTFALL, source: "db_bill.imprest_allotment_master" });
        console.log(`   -> CREDITED Rs ${HO_SHORTFALL}.`);
      }
    }

    // ── 2. Sudeep Negi: create manager + backfill 44 entries ────────────────
    console.log("\n [2/2] Sudeep Negi (Mayapuri) — no HRMS2 manager record, Rs 1,91,946 across 44 entries");
    const [existingMgr] = await conn.query<any[]>(
      `SELECT id FROM imprest_manager WHERE employee_id = ?`, [SUDEEP_EMPLOYEE_ID],
    );
    let sudeepManagerId: string;
    if (existingMgr[0]) {
      sudeepManagerId = String(existingMgr[0].id);
      console.log(`   -> imprest_manager already exists (${sudeepManagerId}), reusing it.`);
    } else if (!APPLY) {
      sudeepManagerId = "(would be created)";
      console.log("   -> Would CREATE imprest_manager (branch: Mayapuri, inactive — branch is closed).");
    } else {
      sudeepManagerId = uuidv4();
      await conn.execute(
        `INSERT INTO imprest_manager
           (id, branch_id, user_id, employee_id, tally_name, effective_from, effective_to,
            active_status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())`,
        [
          sudeepManagerId, MAYAPURI_BRANCH_ID, SUDEEP_USER_ID, SUDEEP_EMPLOYEE_ID,
          "Sudeep Negi Imprest (Mayapuri)", "2019-02-25", "2020-01-27", ACTOR_ID,
        ],
      );
      console.log(`   -> CREATED imprest_manager ${sudeepManagerId} (inactive, closed branch).`);
    }

    const dbbillEntries: Array<{ date: string; amount: number; ref: string; remarks: string }> = [
      { date: "2019-02-25", amount: 2300, ref: "CTF2891309", remarks: "CTF2891309-Rs. 2300 trf to Ratan Singh for System" },
      { date: "2019-02-25", amount: 5000, ref: "021033214391", remarks: "Amount Issued for imprest." },
      { date: "2019-03-13", amount: 3000, ref: "CTF4255688", remarks: "Amount Issued for Imprest" },
      { date: "2019-03-18", amount: 2000, ref: "CNAAPRLCV9", remarks: "Amount Issued for Imprest" },
      { date: "2019-03-26", amount: 2400, ref: "CTF5256808", remarks: "Amount Paid to Ratan Singh for computer Transfer" },
      { date: "2019-04-02", amount: 5000, ref: "912399", remarks: "Amount Issued for Imprest" },
      { date: "2019-04-16", amount: 5000, ref: "951564", remarks: "Amount Issued for Imprest" },
      { date: "2019-04-17", amount: 13000, ref: "CNAAQIXBX3", remarks: "Amount Issued for Imprest" },
      { date: "2019-05-10", amount: 5000, ref: "951386", remarks: "Amount Issued for Imprest" },
      { date: "2019-05-13", amount: 7000, ref: "CNAAQXPQY3", remarks: "Amount Issued for Imprest" },
      { date: "2019-05-13", amount: 5000, ref: "952594", remarks: "Chq. No. 952594 issued for imprest" },
      { date: "2019-05-13", amount: -5000, ref: "952594", remarks: "Chq. No. 952594 issued for imprest wrongly updated" },
      { date: "2019-05-25", amount: -236, ref: "", remarks: "Rs. 236 paid by Parveen for static IP we transferred" },
      { date: "2019-06-03", amount: 5000, ref: "952553", remarks: "Amount Issued for imprest" },
      { date: "2019-06-10", amount: 5000, ref: "CNAARNFLQ2", remarks: "CNAARNFLQ2-trf for electrical work to be done" },
      { date: "2019-06-13", amount: 5000, ref: "952594", remarks: "Chq. No. 952594 issued for imprest" },
      { date: "2019-06-13", amount: 5000, ref: "952595", remarks: "Chq. No. 952595 issued for imprest" },
      { date: "2019-06-18", amount: 4000, ref: "CNAARSGSI0", remarks: "CNAARSGSI0-issued for electrical work" },
      { date: "2019-06-27", amount: 8000, ref: "021324816781", remarks: "021324816781-trf to Nasir for AC work" },
      { date: "2019-06-27", amount: -8000, ref: "21324816781", remarks: "21324816781-reversed against Brothers Air Conditioning" },
      { date: "2019-06-29", amount: 1500, ref: "CNAARYOBH3", remarks: "CNAARYOBH3-trf to imprest account for MCB purchase" },
      { date: "2019-07-02", amount: -1110, ref: "", remarks: "Rs. 1110 reversed against GRN Number Mas/6/19/643" },
      { date: "2019-07-04", amount: 5000, ref: "CNAASBFGK5", remarks: "CNAASBFGK5-Issued for imprest" },
      { date: "2019-07-09", amount: 7000, ref: "CNAASECOH3", remarks: "CNAASECOH3-issued for imprest" },
      { date: "2019-07-16", amount: 5000, ref: "CNAASINRG5", remarks: "CNAASINRG5-issued for imrest Ref Sanjeev Sir" },
      { date: "2019-07-24", amount: -4070, ref: "", remarks: "Rs. 4070 reversed against GRN number Mas/7/19/89" },
      { date: "2019-07-26", amount: 5000, ref: "CNAASNTSY5", remarks: "CNAASNTSY5-issued for imprest" },
      { date: "2019-08-02", amount: 4000, ref: "CNAASRQXK7", remarks: "CNAASRQXK7-Issued for imprest" },
      { date: "2019-08-23", amount: 5000, ref: "CNAATDVSJ0", remarks: "CNAATDVSJ0-Issued for imprest" },
      { date: "2019-09-11", amount: 5000, ref: "CNAATPAZV0", remarks: "CNAATPAZV0-issued for imprest" },
      { date: "2019-09-26", amount: 4000, ref: "CNAATYNFG5", remarks: "CNAATYNFG5-Issued for imprest" },
      { date: "2019-10-05", amount: 5000, ref: "CTH2528818", remarks: "CTH2528818-Amount transferred to Mr. Sanjeev Tyagi" },
      { date: "2019-10-25", amount: 4000, ref: "CNAAUSFVR4", remarks: "CNAAUSFVR4-Issued for imprest" },
      { date: "2019-10-25", amount: 15000, ref: "CTH4704297", remarks: "CTH4704297-Issued for Diwali Gifts" },
      { date: "2019-11-08", amount: 5000, ref: "CNAAVBACH0", remarks: "CNAAVBACH0-issued for imprest" },
      { date: "2019-11-22", amount: 6000, ref: "CNAAVKGQG3", remarks: "CNAAVKGQG3-issued for imprest" },
      { date: "2019-12-11", amount: 4000, ref: "CNAAVWIKN8", remarks: "CNAAVWIKN8-issued for imprest" },
      { date: "2019-12-12", amount: 5000, ref: "CNAAWBOXV1", remarks: "CNAAWBOXV1-issued for imprest ref Mr. Sanjeev Tyagi" },
      { date: "2019-12-12", amount: -5000, ref: "CNAAWBOXV1", remarks: "CNAAWBOXV1-reversed due to wrongly updated" },
      { date: "2019-12-19", amount: 5000, ref: "CNAAWBOXV1", remarks: "CNAAWBOXV1-issued for imprest ref Mr. Sanjeev Tyagi" },
      { date: "2020-01-02", amount: 14000, ref: "", remarks: "Rs. 14000 given to Parveen for Mayapuri" },
      { date: "2020-01-03", amount: 9000, ref: "CNAAWLBNF5", remarks: "CNAAWLBNF5-issued for electrical and other work" },
      { date: "2020-01-15", amount: 10000, ref: "CNAAWULVW2", remarks: "CNAAWULVW2-issued to Sanjeev Tyagi on behalf of Mayapuri" },
      { date: "2020-01-27", amount: 5162, ref: "CNAAXBPSC2", remarks: "CNAAXBPSC2-issued for imprest" },
    ];
    const sum = dbbillEntries.reduce((s, e) => s + e.amount, 0);
    console.log(`   ${dbbillEntries.length} entries, net sum Rs ${sum} (must equal 191946: ${sum === 191946 ? "OK" : "MISMATCH — STOP"})`);
    if (sum !== 191946) throw new Error("Entry sum does not match the verified db_bill total — aborting.");

    if (!APPLY) {
      console.log(`   -> Would post ${dbbillEntries.length} ledger entries (credits and debits) totalling Rs ${sum} net.`);
    } else {
      const [alreadyPosted] = await conn.query<any[]>(
        `SELECT COUNT(*) AS cnt FROM imprest_transaction_ledger WHERE imprest_manager_id = ?`,
        [sudeepManagerId],
      );
      if (Number(alreadyPosted[0]?.cnt ?? 0) > 0) {
        console.log("   -> Ledger already has entries for this manager. Skipping to avoid duplicates.");
      } else {
        for (const e of dbbillEntries) {
          await postLedgerEntry(
            conn, sudeepManagerId, MAYAPURI_BRANCH_ID, "allocation",
            e.amount >= 0 ? "credit" : "debit", Math.abs(e.amount), e.date,
            `db_bill migration backfill 2026-09-01 (ref ${e.ref || "n/a"}): ${e.remarks}`,
          );
        }
        await writeAudit(conn, sudeepManagerId, {
          entries_posted: dbbillEntries.length, net_amount: sum, source: "db_bill.imprest_allotment_master",
        });
        console.log(`   -> POSTED ${dbbillEntries.length} entries, net Rs ${sum}.`);
      }
    }

    console.log(APPLY ? "\n Apply complete.\n" : "\n DRY RUN complete — nothing written.\n");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFIX FAILED:", err.message ?? err);
  process.exit(1);
});
