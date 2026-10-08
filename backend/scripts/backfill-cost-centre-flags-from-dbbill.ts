/**
 * Restore revenue_flag / billing_flag on cost_centre_master from db_bill.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * WHY. Measured 2026-08-17: revenue_flag and billing_flag are 0 on ALL 437 active cost centres,
 * and client_id is NULL on all of them. So nothing in HRMS2 can tell a cost centre that raises a
 * client invoice from one that does not — which is exactly the question you must answer before
 * deciding which cost centres need an outward SAC for the GSTR-1 summary.
 *
 * db_bill.cost_master carries both, and they are real: Revenue = 1 on 927 of 928, Billing split
 * 504 / 424. Joined on cost_centre_master.bill_source_id -> cost_master.id, 919 of 927 HRMS rows
 * match with ZERO broken keys; the 8 unmatched have no bill_source_id at all (created in HRMS2
 * after the migration, so there is nothing upstream for them).
 *
 * NOT ATTEMPTED: client_id. cost_centre_master.client_name holds the legacy BILLING client
 * ("Buddy 4 Study", "Onfido BO-Ahmedabad", "CYFUTURE INDIA PRIVATE LIMITED") while HRMS2's
 * client_master has 12 rows on a different taxonomy — only 4 of 785 names match. Inferring the FK
 * from that text would repeat the process_id mistake, which measured 2.9% accurate and was
 * deliberately left blank instead. See the hrms2-cost-centre-not-process finding.
 *
 * ⚠️ THIS IS NOT A BLANK-FILL. Unlike the vendor backfill, the target columns are NOT NULL and
 * already hold 0, so "unset" and "explicitly not billable" are indistinguishable. Every write here
 * therefore CHANGES an existing value rather than filling a hole. That is the point — the current
 * 0s are a migration default, not a decision — but it means this is not silently reversible, hence
 * the snapshot the runbook takes first.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const APPLY = process.argv.includes("--apply");

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST, port: Number(process.env.BILL_DB_PORT),
    user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD, database: process.env.BILL_DB_NAME,
  });

  try {
    const [hrmsRows] = await hrms.query<any[]>(
      `SELECT id, cost_centre_code, bill_source_id, active_status, revenue_flag, billing_flag, sac_code
         FROM cost_centre_master`
    );
    const [billRows] = await bill.query<any[]>(`SELECT id, Revenue, Billing FROM cost_master`);
    const source = new Map(billRows.map((r) => [String(r.id), r]));

    const updates: Array<{ id: string; revenue: number; billing: number; code: string }> = [];
    let noKey = 0, unchanged = 0;
    const activeBilling = { total: 0, withSac: 0, needsSac: 0 };

    for (const row of hrmsRows) {
      if (row.bill_source_id == null) { noKey += 1; continue; }
      const src = source.get(String(row.bill_source_id));
      if (!src) { noKey += 1; continue; }

      const revenue = Number(src.Revenue) === 1 ? 1 : 0;
      const billing = Number(src.Billing) === 1 ? 1 : 0;

      if (row.active_status === 1 && billing === 1) {
        activeBilling.total += 1;
        if (/^[0-9]{4,8}$/.test(String(row.sac_code ?? ""))) activeBilling.withSac += 1;
        else activeBilling.needsSac += 1;
      }

      if (Number(row.revenue_flag) === revenue && Number(row.billing_flag) === billing) { unchanged += 1; continue; }
      updates.push({ id: String(row.id), revenue, billing, code: String(row.cost_centre_code) });
    }

    console.log(`\nHRMS cost centres            : ${hrmsRows.length}`);
    console.log(`No usable bill_source_id     : ${noKey}  (HRMS2-native, nothing upstream)`);
    console.log(`Already correct              : ${unchanged}`);
    console.log(`Would change                 : ${updates.length}\n`);
    console.table([
      { flag: "revenue_flag -> 1", rows: updates.filter((u) => u.revenue === 1).length },
      { flag: "billing_flag -> 1", rows: updates.filter((u) => u.billing === 1).length },
      { flag: "billing_flag -> 0", rows: updates.filter((u) => u.billing === 0).length },
    ]);

    console.log("\n── What this unlocks: the outward SAC question, finally scoped ──");
    console.log(`ACTIVE cost centres that actually bill a client : ${activeBilling.total}`);
    console.log(`  of those, already carry a SAC                : ${activeBilling.withSac}`);
    console.log(`  of those, genuinely missing one              : ${activeBilling.needsSac}`);
    console.log("(Previously unanswerable — every active cost centre read as non-billing.)");

    if (!APPLY) {
      console.log("\nDRY RUN — nothing written. Re-run with --apply to commit.");
      return;
    }

    let written = 0;
    for (const update of updates) {
      await hrms.execute(
        `UPDATE cost_centre_master SET revenue_flag = ?, billing_flag = ? WHERE id = ?`,
        [update.revenue, update.billing, update.id]
      );
      written += 1;
    }
    console.log(`\nAPPLIED — ${written} cost centre row(s) updated.`);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch((error) => { console.error("FAILED:", error); process.exit(1); });
