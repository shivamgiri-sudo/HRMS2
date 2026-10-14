/**
 * One-time: anchor each active company bank account's ledger at the opening balance finance entered.
 *
 * Finance entered the real balances on 2026-10-07 (POWER ₹16,65,947, SBI CC ₹56,02,224, ICICI AV
 * ₹3,61,944) but opening_balance_as_of stayed at the account-creation date (2026-09-11) and the stored
 * running balances were never recomputed, so screens showed e.g. ICICI AV -₹33.36 Cr. This sets the
 * as-of date (AS_OF, default 2026-10-07 — the day the figures were entered) on active accounts that
 * have a non-zero opening balance, then re-anchors every active account's chain (bank-ledger-anchor.ts).
 * Closed accounts are left alone. Audited per account in sensitive_action_log.
 *
 * Run (backend/): MODE=dry-run|apply [AS_OF=YYYY-MM-DD] CONFIRM=anchor-bank-ledger npx tsx scripts/bank-ledger-anchor-rebase.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { rebaseRunningBalances } from "../src/modules/finance/bank-ledger-anchor.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const MODE = process.env.MODE ?? "dry-run";
const AS_OF = process.env.AS_OF ?? "2026-10-07";
if (!/^\d{4}-\d{2}-\d{2}$/.test(AS_OF)) throw new Error(`AS_OF must be YYYY-MM-DD (got ${AS_OF})`);
if (MODE !== "dry-run" && MODE !== "apply") throw new Error(`MODE must be dry-run or apply (got ${MODE})`);
if (MODE === "apply" && process.env.CONFIRM !== "anchor-bank-ledger") throw new Error("apply needs CONFIRM=anchor-bank-ledger");

async function main() {
  const [accts] = await db.query<RowDataPacket[]>(
    `SELECT id, account_name, account_number_last4 l4, opening_balance, DATE_FORMAT(opening_balance_as_of, '%Y-%m-%d') as_of
       FROM company_bank_account WHERE active_status = 1 ORDER BY account_name`);
  console.log(`MODE=${MODE} AS_OF=${AS_OF}: ${accts.length} active bank accounts`);
  const actor = (await db.query<RowDataPacket[]>(
    `SELECT au.id FROM auth_user au JOIN user_roles ur ON ur.user_id = au.id WHERE ur.role_key = 'super_admin' AND ur.active_status = 1 ORDER BY au.id LIMIT 1`))[0][0];
  for (const a of accts) {
    const setAsOf = Number(a.opening_balance) !== 0 && a.as_of !== AS_OF;
    let preview;
    if (MODE === "apply") {
      if (setAsOf) await db.query(`UPDATE company_bank_account SET opening_balance_as_of = ? WHERE id = ?`, [AS_OF, a.id]);
      preview = await rebaseRunningBalances(String(a.id), db);
    } else {
      // Preview with the new as-of date inside a transaction that is always rolled back.
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        if (setAsOf) await conn.query(`UPDATE company_bank_account SET opening_balance_as_of = ? WHERE id = ?`, [AS_OF, a.id]);
        preview = await rebaseRunningBalances(String(a.id), conn, { dryRun: true });
      } finally {
        await conn.rollback();
        conn.release();
      }
    }
    console.log(`${a.account_name} ..${a.l4 ?? ""}: opening ₹${Number(a.opening_balance).toLocaleString("en-IN")} as of ${setAsOf ? `${a.as_of} -> ${AS_OF}` : a.as_of}; ` +
      `${preview.rows} entries, ${preview.changed} running balances ${MODE === "apply" ? "rewritten" : "would change"}; balance ₹${Number(preview.balanceBefore ?? 0).toLocaleString("en-IN")} -> ₹${preview.balanceAfter.toLocaleString("en-IN")}`);
    if (MODE === "apply") {
      await logSensitiveAction({
        actor_user_id: String(actor?.id ?? "system"),
        action_type: "COMPANY_BANK_ACCOUNT_LEDGER_REANCHORED",
        module_key: "FINANCE",
        entity_type: "company_bank_account",
        entity_id: String(a.id),
        change_summary: { account_name: a.account_name, opening_balance: Number(a.opening_balance), as_of_before: a.as_of, as_of_after: setAsOf ? AS_OF : a.as_of, entries: preview.rows, running_balances_rewritten: preview.changed, balance_before: preview.balanceBefore, balance_after: preview.balanceAfter },
      }).catch((e) => console.log("audit write failed:", (e as Error).message));
    }
  }
  if (MODE !== "apply") console.log("\nDry run: nothing written.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.end().catch(() => {}));
