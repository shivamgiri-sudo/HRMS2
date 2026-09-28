/**
 * Link cost_centre_master.process_id to process_master, so the P&L revenue chain
 * (cost centre -> process -> process_lob_master -> process_revenue_rule) has a source
 * fact instead of a NULL. DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * WHY THIS EXISTS. cost_centre_master is populated by one-off backfill scripts against
 * db_bill (see the other backfill-cost-centre-*-from-dbbill.ts scripts in this directory) --
 * there is no live sync, so process_id is never filled automatically for a newly-imported
 * cost centre. Traced and manually fixed for 23 rows on 2026-09-10; this script makes that
 * fix re-runnable instead of another one-off, so the next batch of new cost centres (or a
 * fresh db_bill import) doesn't reopen the same gap silently.
 *
 * MATCH RULE. Exact string match on cost_centre_master.process_name_bill =
 * process_master.process_name only. Deliberately NOT fuzzy -- checked on 2026-09-10 and
 * fuzzy/employee-derived matching produces genuine many-to-many ambiguity for shared/support
 * cost centres (e.g. a "FINANCE/ACCOUNTS" cost centre serving 3 different processes). An
 * exact match is unambiguous by construction; anything that doesn't match exactly is left
 * for a human, reported but not guessed.
 *
 * DIALDESK EXCLUDED. Per explicit decision (2026-09-10, see also
 * hrms2-dialdesk-ispark-out-of-scope memory): any cost_centre_code containing "DIALDESK" or
 * "-DD/", or a process_name_bill of "DIALDESK"/"Dialdesk", is skipped entirely.
 *
 * ONLY EVER FILLS A NULL, never overwrites an existing process_id. Re-runnable.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const APPLY = process.argv.includes("--apply");

const isDialdesk = (costCentreCode: string, processNameBill: string | null) =>
  costCentreCode.includes("DIALDESK") ||
  costCentreCode.includes("-DD/") ||
  (processNameBill ?? "").trim().toLowerCase() === "dialdesk";

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const [candidates] = await hrms.execute<any[]>(
      `SELECT ccm.id AS cc_id, ccm.cost_centre_code, ccm.process_name_bill, pm.id AS matched_process_id
         FROM cost_centre_master ccm
         JOIN process_master pm ON pm.process_name = ccm.process_name_bill
        WHERE ccm.process_id IS NULL
          AND ccm.process_name_bill IS NOT NULL AND ccm.process_name_bill NOT IN ('', '0')`
    );

    const toLink = candidates.filter((r) => !isDialdesk(r.cost_centre_code, r.process_name_bill));
    const skippedDialdesk = candidates.length - toLink.length;

    console.log(`exact process-name matches with process_id still NULL: ${candidates.length}`);
    console.log(`  -> DialDesk-excluded: ${skippedDialdesk}`);
    console.log(`  -> eligible to link: ${toLink.length}`);
    toLink.forEach((r) =>
      console.log(`  ${r.cost_centre_code} | "${r.process_name_bill}" -> ${r.matched_process_id}`)
    );

    const [unmatchedCount] = await hrms.execute<any[]>(
      `SELECT COUNT(*) AS c FROM cost_centre_master ccm
        WHERE ccm.process_id IS NULL
          AND ccm.process_name_bill IS NOT NULL AND ccm.process_name_bill NOT IN ('', '0')
          AND ccm.cost_centre_code NOT LIKE '%DIALDESK%' AND ccm.cost_centre_code NOT LIKE '%-DD/%'
          AND NOT EXISTS (SELECT 1 FROM process_master pm WHERE pm.process_name = ccm.process_name_bill)`
    );
    console.log(
      `\nremaining non-DialDesk cost centres with NO exact process-name match (need a human): ${unmatchedCount[0].c}`
    );

    if (!APPLY) {
      console.log("\nDry run only -- pass --apply to write.");
      return;
    }

    await hrms.beginTransaction();
    let updated = 0;
    try {
      for (const r of toLink) {
        const [res] = await hrms.execute(
          "UPDATE cost_centre_master SET process_id = ? WHERE id = ? AND process_id IS NULL",
          [r.matched_process_id, r.cc_id]
        );
        if ((res as any).affectedRows !== 1) throw new Error(`unexpected affectedRows for ${r.cc_id}`);
        updated++;
      }
      await hrms.commit();
      console.log(`\nCOMMITTED. process_id linked on ${updated} rows.`);
    } catch (e) {
      await hrms.rollback();
      throw e;
    }
  } finally {
    await hrms.end();
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
