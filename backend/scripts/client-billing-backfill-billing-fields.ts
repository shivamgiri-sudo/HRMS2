/**
 * Fill BLANK billing fields on MAS cost centres from I-Spark's cost_master (db_bill), so HRMS
 * invoices print the same Bill To / Ship To / HSN / state as I-Spark. Never overwrites a value
 * HRMS already has. Matched on cost_centre_code = cost_master.cost_center.
 *
 *   MODE=dry-run (default)  prints what would be filled, per cost centre; writes nothing.
 *   MODE=apply CONFIRM=fill-blank-billing-fields   writes in one transaction.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const MODE = (process.env.MODE ?? "dry-run").trim();
if (MODE !== "dry-run" && MODE !== "apply") throw new Error(`MODE must be dry-run or apply (got ${MODE})`);
if (MODE === "apply" && process.env.CONFIRM !== "fill-blank-billing-fields") throw new Error("apply needs CONFIRM=fill-blank-billing-fields");

/** HRMS column <- legacy cost_master column */
const MAP: Array<[string, string]> = [
  ["bill_to_address1", "b_Address1"], ["bill_to_address2", "b_Address2"], ["bill_to_address3", "b_Address3"],
  ["bill_to_address4", "b_Address4"], ["bill_to_address5", "b_Address5"],
  ["ship_to_address1", "a_address1"], ["ship_to_address2", "a_address2"], ["ship_to_address3", "a_address3"],
  ["ship_to_address4", "a_address4"], ["ship_to_address5", "a_address5"],
  ["vendor_gst_no", "VendorGSTNo"], ["vendor_gst_state", "VendorGSTState"], ["vendor_state_code", "VendorStateCode"],
  ["hsn_code", "HSNCode"], ["sac_code", "SACCode"], ["service_tax_no", "ServiceTaxNo"],
];
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
/** Legacy text has mojibake for the en dash ("Telangana ??? 500081"); store a plain hyphen. */
const clean = (v: unknown) => String(v ?? "").replace(/\s*(\?{2,}|â€“|–|—)\s*/g, " - ").replace(/\s+/g, " ").trim().slice(0, 255);

async function main() {
  const own = "REPLACE(REPLACE(REPLACE(LOWER(COALESCE(company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'";
  const [hrms] = await db.query<RowDataPacket[]>(
    `SELECT id, cost_centre_code, active_status, ${MAP.map(([h]) => h).join(", ")} FROM cost_centre_master WHERE ${own}`,
  );
  const codes = hrms.map((r) => String(r.cost_centre_code));
  const legacy = codes.length
    ? await billQuery<RowDataPacket>(
        `SELECT cost_center, ${MAP.map(([, l]) => l).join(", ")} FROM cost_master WHERE cost_center IN (${codes.map(() => "?").join(",")})`,
        codes,
      )
    : [];
  const byCode = new Map<string, RowDataPacket>();
  for (const l of legacy) if (!byCode.has(String(l.cost_center))) byCode.set(String(l.cost_center), l);

  const plans: Array<{ id: string; code: string; active: number; set: Record<string, string> }> = [];
  for (const r of hrms) {
    const l = byCode.get(String(r.cost_centre_code));
    if (!l) continue;
    const set: Record<string, string> = {};
    for (const [h, lc] of MAP) if (blank(r[h]) && !blank(l[lc])) set[h] = clean(l[lc]);
    if (Object.keys(set).length) plans.push({ id: String(r.id), code: String(r.cost_centre_code), active: Number(r.active_status), set });
  }
  const stillBlank = hrms.filter((r) => Number(r.active_status) === 1 && blank(r.bill_to_address1) && !plans.find((p) => p.id === r.id && p.set.bill_to_address1));
  console.log(`MODE=${MODE}: ${hrms.length} MAS cost centres, ${plans.length} get blanks filled (${plans.filter((p) => p.active === 1).length} active).`);
  for (const p of plans) console.log(`${p.active ? "ACTIVE  " : "inactive"} ${p.code}: ${Object.entries(p.set).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" | ")}`);
  console.log(`\nActive cost centres still without a Bill To address after this (need manual entry): ${stillBlank.length}`);
  for (const r of stillBlank) console.log(`  ${r.cost_centre_code}`);

  if (MODE !== "apply") { console.log("\nDry run: nothing written."); return; }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let n = 0;
    for (const p of plans) {
      const cols = Object.keys(p.set);
      // Re-check blank under the write, so a value typed in HRMS meanwhile is never overwritten.
      const sql = `UPDATE cost_centre_master SET ${cols.map((c) => `${c} = IF(${c} IS NULL OR TRIM(${c}) = '', ?, ${c})`).join(", ")} WHERE id = ?`;
      await conn.execute(sql, [...cols.map((c) => p.set[c]), p.id]);
      n++;
    }
    await conn.commit();
    console.log(`\nApplied to ${n} cost centres.`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closeBillPool(); await db.end().catch(() => {}); });
