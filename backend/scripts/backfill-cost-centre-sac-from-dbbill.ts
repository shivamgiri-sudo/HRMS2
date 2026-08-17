/**
 * Recover cost_centre_master.sac_code from db_bill for billing cost centres that lack one.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * SCOPE. Only ACTIVE cost centres with billing_flag = 1 — the ones that actually raise a client
 * invoice, and therefore the only ones with an outward supply to classify for the GSTR-1 HSN/SAC
 * summary. That scoping only became possible once the billing flags were restored; before that
 * every active cost centre read as non-billing and the gap looked like 383 rather than 55.
 *
 * WHY ANYTHING IS RECOVERABLE. db_bill used its four code columns interchangeably — the same
 * 998593 turns up under SACCode on one row and HSNCode on the next, with the unused one set to
 * "NA". The original migration read SACCode only, so every cost centre whose code happened to sit
 * in HSNCode arrived here empty. Reading all four recovers 23 of the 55.
 *
 * WHAT IS NOT DONE. The other 32 have no real code in db_bill either, under any of the four
 * columns. They are left alone. Stamping 998593 on them because it is the only code this business
 * uses would be an inference, and this column feeds a statutory return — the same reason the
 * 1941 -> 194I correction waited for the data owner and client_id was never guessed from names.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const APPLY = process.argv.includes("--apply");
const isRealCode = (value: unknown) => /^[0-9]{4,8}$/.test(String(value ?? "").trim());

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
    const [targets] = await hrms.query<any[]>(
      `SELECT id, cost_centre_code, bill_source_id, cc_type, cc_category
         FROM cost_centre_master
        WHERE active_status = 1
          AND billing_flag = 1
          AND NOT (COALESCE(sac_code, '') REGEXP '^[0-9]{4,8}$')`
    );
    const keys = targets.map((r) => r.bill_source_id).filter((v) => v != null);
    if (!keys.length) { console.log("Nothing to do — every billing cost centre already has a SAC."); return; }

    const [srcRows] = await bill.query<any[]>(
      `SELECT id, SACCode, HSNCode, VendorSACCode, VendorHSNCode
         FROM cost_master WHERE id IN (${keys.map(() => "?").join(",")})`,
      keys
    );
    const source = new Map(srcRows.map((r) => [String(r.id), r]));

    const recoverable: Array<{ id: string; code: string; cc: string }> = [];
    const stranded: Array<{ cc: string; type: string; category: string }> = [];

    for (const row of targets) {
      const src = source.get(String(row.bill_source_id));
      // All four columns, because legacy filled whichever it felt like and "NA"d the rest.
      const found = [src?.SACCode, src?.HSNCode, src?.VendorSACCode, src?.VendorHSNCode].find(isRealCode);
      if (found) recoverable.push({ id: String(row.id), code: String(found).trim(), cc: String(row.cost_centre_code) });
      else stranded.push({ cc: String(row.cost_centre_code), type: String(row.cc_type ?? "-"), category: String(row.cc_category ?? "-") });
    }

    console.log(`\nActive + billing cost centres with no usable SAC : ${targets.length}`);
    console.log(`  recoverable from db_bill                      : ${recoverable.length}`);
    console.log(`  nothing upstream either — left for a human     : ${stranded.length}\n`);

    const byCode = new Map<string, number>();
    for (const r of recoverable) byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1);
    console.log("Codes that would be written:");
    console.table([...byCode.entries()].map(([code, n]) => ({ code, rows: n })));

    if (stranded.length) {
      console.log("\nLeft untouched (no code anywhere in db_bill) — these need a decision:");
      console.table(stranded.slice(0, 40));
      if (stranded.length > 40) console.log(`  … and ${stranded.length - 40} more`);
    }

    if (!APPLY) {
      console.log("\nDRY RUN — nothing written. Re-run with --apply to commit.");
      return;
    }

    for (const row of recoverable) {
      await hrms.execute(`UPDATE cost_centre_master SET sac_code = ? WHERE id = ?`, [row.code, row.id]);
    }
    console.log(`\nAPPLIED — ${recoverable.length} cost centre(s) given their SAC from db_bill.`);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch((error) => { console.error("FAILED:", error); process.exit(1); });
