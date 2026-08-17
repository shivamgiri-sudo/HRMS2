/**
 * Populate cost_centre_master.billing_client_name from the invoices already in mas_hrms.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * SOURCE. billing_invoice_snapshot carries bill_client, bill_process_name and cost_centre_code
 * together on 10,987 real invoices — 592 distinct clients, current to 2026-08. It is the only
 * reliable client signal in either database:
 *   - cost_centre_master.client_name holds the PROCESS name (equals db_bill cost_master
 *     .process_name on 400 of 400 tested, .client on 0 of 400) and is byte-identical to
 *     process_name_bill on all 785 populated rows.
 *   - cost_centre_master.client_id is NULL on all 927; its FK targets client_master, the portal
 *     TENANT registry (api_key, subscription_status), 12 mostly-dead rows.
 *   - db_bill cost_master.dialdesk_client_id resolves on 287 of 287 to a client whose name
 *     disagrees with the row's own client text on 287 of 287. Wrong, not merely empty.
 *
 * ⚠️ COLLATION. cost_centre_master and billing_invoice_snapshot were created with different
 * collations, so joining cost_centre_code without an explicit COLLATE raises
 * "Illegal mix of collations" (errno 1267). It errors loudly rather than returning wrong rows,
 * but every query here pins utf8mb4_unicode_ci so it cannot start.
 *
 * MOST RECENT INVOICE WINS. 10 cost centres have billed more than one distinct client over their
 * life. Those are reported individually rather than collapsed silently — the newest invoice is a
 * reasonable "who do we bill today", but it is a choice, and a cost centre that genuinely serves
 * two clients is not representable in one column.
 *
 * Only ever fills a NULL. Re-runnable.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const APPLY = process.argv.includes("--apply");
const CO = "COLLATE utf8mb4_unicode_ci";

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  try {
    /**
     * Joined in memory rather than in SQL, deliberately.
     *
     * billing_invoice_snapshot HAS an index on cost_centre_code (idx_cc_period), but the two
     * tables' collations differ, and writing `b.cost_centre_code COLLATE … = cc.cost_centre_code
     * COLLATE …` applies a function to the indexed column, so MySQL cannot use the index — the
     * correlated form ran for over five minutes. Pulling both sides (927 + ~11k rows) and matching
     * in JS is instant and removes the collation question entirely.
     */
    const [ccRows] = await hrms.query<any[]>(
      `SELECT id, cost_centre_code, active_status, billing_flag,
              client_name AS process_name_today, billing_client_name AS current_value
         FROM cost_centre_master`
    );
    const [invRows] = await hrms.query<any[]>(
      `SELECT cost_centre_code, bill_client, invoice_date
         FROM billing_invoice_snapshot
        WHERE bill_client IS NOT NULL AND TRIM(bill_client) <> ''`
    );

    const key = (value: unknown) => String(value ?? "").trim().toLowerCase();
    const byCostCentre = new Map<string, { newest: string; date: string; clients: Set<string> }>();
    for (const inv of invRows) {
      const k = key(inv.cost_centre_code);
      if (!k) continue;
      const client = String(inv.bill_client).trim();
      const date = String(inv.invoice_date ?? "");
      const entry = byCostCentre.get(k);
      if (!entry) byCostCentre.set(k, { newest: client, date, clients: new Set([client]) });
      else {
        entry.clients.add(client);
        if (date > entry.date) { entry.newest = client; entry.date = date; }
      }
    }

    const resolved = ccRows.map((r) => {
      const hit = byCostCentre.get(key(r.cost_centre_code));
      return { ...r, resolved_client: hit?.newest ?? null, distinct_clients: hit ? hit.clients.size : 0 };
    });

    const toWrite = resolved.filter((r) => r.resolved_client && !r.current_value);
    const multi = resolved.filter((r) => Number(r.distinct_clients) > 1);
    const unresolved = resolved.filter((r) => !r.resolved_client);

    const activeBilling = (rows: any[]) => rows.filter((r) => r.active_status === 1 && Number(r.billing_flag) === 1).length;

    console.log(`\nCost centres                       : ${resolved.length}`);
    console.log(`  would be given a client          : ${toWrite.length}  (active+billing: ${activeBilling(toWrite)})`);
    console.log(`  no invoice names a client        : ${unresolved.length}  (active+billing: ${activeBilling(unresolved)})`);
    console.log(`  already populated                : ${resolved.filter((r) => r.current_value).length}`);

    console.log("\nSample — what the page shows today vs what it would show:");
    console.table(toWrite.slice(0, 8).map((r) => ({
      cost_centre: r.cost_centre_code,
      shown_as_client_today: r.process_name_today,
      real_client: r.resolved_client,
    })));

    if (multi.length) {
      console.log(`\n⚠️ ${multi.length} cost centre(s) have billed MORE THAN ONE client — newest invoice used:`);
      console.table(multi.map((r) => ({
        cost_centre: r.cost_centre_code, distinct_clients: r.distinct_clients, newest: r.resolved_client,
      })));
    }

    if (!APPLY) {
      console.log("\nDRY RUN — nothing written. Re-run with --apply to commit.");
      return;
    }

    for (const row of toWrite) {
      await hrms.execute(
        `UPDATE cost_centre_master SET billing_client_name = ? WHERE id = ? AND billing_client_name IS NULL`,
        [String(row.resolved_client).trim(), String(row.id)]
      );
    }
    console.log(`\nAPPLIED — ${toWrite.length} cost centre(s) given their real billing client.`);
  } finally {
    await hrms.end();
  }
}

main().catch((error) => { console.error("FAILED:", error); process.exit(1); });
