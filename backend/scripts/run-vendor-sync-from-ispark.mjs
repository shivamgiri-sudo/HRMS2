/**
 * One-shot script: pull new vendors from db_bill.tbl_vendormaster into mas_hrms.vendor_master.
 *
 * DRY RUN by default — pass --apply to actually write.
 *
 * Usage:
 *   node scripts/run-vendor-sync-from-ispark.mjs
 *   node scripts/run-vendor-sync-from-ispark.mjs --apply
 */
import mysql from "mysql2/promise";
import { randomUUID } from "crypto";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const APPLY = process.argv.includes("--apply");

const PLACEHOLDERS = new Set(["na", "n/a", "n.a.", "-", "--", "nil", "none", "null", ""]);
function blankToNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return PLACEHOLDERS.has(s.toLowerCase()) ? null : s || null;
}
function ratioToNull(raw) {
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

async function main() {
  const hrms = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const bill = await mysql.createConnection({
    host: process.env.BILL_DB_HOST,
    port: Number(process.env.BILL_DB_PORT) || 3306,
    user: process.env.BILL_DB_USER,
    password: process.env.BILL_DB_PASSWORD,
    database: process.env.BILL_DB_NAME,
  });

  try {
    console.log(`[vendor-sync] Connecting to db_bill (${process.env.BILL_DB_HOST}/${process.env.BILL_DB_NAME}) ...`);
    const [billRows] = await bill.query(
      "SELECT Id, vendor, TallyHead, state, pincode, TDS, TDSSection, TDSEnabled FROM tbl_vendormaster"
    );
    console.log(`[vendor-sync] db_bill rows: ${billRows.length}`);

    const [existingRows] = await hrms.query(
      "SELECT vendor_code FROM vendor_master WHERE vendor_code LIKE 'DB_BILL_%'"
    );
    const existingCodes = new Set(existingRows.map((r) => String(r.vendor_code)));
    console.log(`[vendor-sync] mas_hrms existing DB_BILL vendors: ${existingCodes.size}`);

    const toInsert = [];
    let skippedExists = 0;
    let skippedBlank  = 0;

    for (const row of billRows) {
      const vendorCode = `DB_BILL_${row.Id}`;
      if (existingCodes.has(vendorCode)) { skippedExists += 1; continue; }

      const vendorName = blankToNull(row.vendor);
      if (!vendorName)  { skippedBlank += 1;  continue; }

      toInsert.push({
        id:          randomUUID(),
        vendor_code: vendorCode,
        vendor_name: vendorName,
        tally_name:  blankToNull(row.TallyHead),
        state:       blankToNull(row.state),
        pin_code:    blankToNull(row.pincode),
        tds_rate:    ratioToNull(row.TDS),
        tds_enabled: Number(row.TDSEnabled) === 1 ? 1 : 0,
        tds_section: blankToNull(row.TDSSection)?.slice(0, 20) ?? null,
      });
    }

    console.log(`\n--- Summary ---`);
    console.log(`  Total in db_bill       : ${billRows.length}`);
    console.log(`  Already in mas_hrms    : ${skippedExists}`);
    console.log(`  Blank vendor name      : ${skippedBlank}`);
    console.log(`  NEW to insert          : ${toInsert.length}`);

    if (toInsert.length > 0) {
      console.log(`\n--- New vendors (first 20) ---`);
      toInsert.slice(0, 20).forEach((v) =>
        console.log(`  ${v.vendor_code.padEnd(16)} ${v.vendor_name}${v.tally_name ? ' [tally: ' + v.tally_name + ']' : ''}`)
      );
      if (toInsert.length > 20) console.log(`  ... and ${toInsert.length - 20} more`);
    }

    if (!APPLY) {
      console.log(`\nDRY RUN — nothing written. Re-run with --apply to insert.`);
      return;
    }

    let written = 0;
    for (const v of toInsert) {
      await hrms.execute(
        `INSERT INTO vendor_master
           (id, vendor_code, vendor_name, vendor_type, tally_name, state, pin_code,
            tds_rate, tds_enabled, tds_section, is_active)
         VALUES (?, ?, ?, 'supplier', ?, ?, ?, ?, ?, ?, 1)`,
        [v.id, v.vendor_code, v.vendor_name, v.tally_name, v.state, v.pin_code,
         v.tds_rate, v.tds_enabled, v.tds_section]
      );
      written += 1;
    }
    console.log(`\nAPPLIED — ${written} vendor(s) inserted into mas_hrms.vendor_master.`);

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
