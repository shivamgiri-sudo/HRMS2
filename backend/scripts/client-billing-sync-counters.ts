/**
 * Bring HRMS client-billing number counters up to the legacy I-Spark (db_bill) counters, so HRMS
 * can never issue a bill / proforma number that I-Spark already issued.
 *
 * Only ever RAISES a counter (GREATEST), never lowers one. Reads db_bill with SELECT only.
 *   MODE=dry-run (default)  prints current vs legacy and the planned value; writes nothing.
 *   MODE=apply CONFIRM=raise-billing-counters   writes, inside one transaction.
 *
 * Scopes match client-billing-numbering.service.ts:
 *   bill:     `${state_code}|${normalised company}|${finance_year}` (counterScopeKey: company lower
 *             case without spaces / dots / commas; legacy MAX(BillNoChange) per state_code +
 *             cost_company_name for that FY, spellings of one company folded together with MAX)
 *   proforma: `GLOBAL` (legacy proforma numbers share one counter across states: PI/09 and
 *             PI/24 interleave up to bill_no_master's value)
 * Run this at go-live, after I-Spark stops issuing numbers; I-Spark keeps counting until then.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";
import { counterScopeKey } from "../src/modules/client-billing/client-billing-numbering.service.js";

const MODE = (process.env.MODE ?? "dry-run").trim();
const FINANCE_YEAR = (process.env.FINANCE_YEAR ?? "2026-27").trim();
if (!/^\d{4}-\d{2}$/.test(FINANCE_YEAR)) throw new Error(`FINANCE_YEAR must look like 2026-27 (got ${FINANCE_YEAR})`);
if (MODE !== "dry-run" && MODE !== "apply") throw new Error(`MODE must be dry-run or apply (got ${MODE})`);
if (MODE === "apply" && process.env.CONFIRM !== "raise-billing-counters") {
  throw new Error("apply needs CONFIRM=raise-billing-counters");
}

interface Plan { kind: "bill" | "proforma"; scopeKey: string; hrms: number | null; legacy: number; target: number }

async function main() {
  const legacyBills = await billQuery<RowDataPacket>(
    `SELECT state_code, cost_company_name AS company, MAX(BillNoChange) AS max_idx
     FROM tbl_invoice
     WHERE (bill_finance_year = ? OR finance_year = ?) AND state_code IS NOT NULL AND state_code <> ''
       AND cost_company_name IS NOT NULL AND cost_company_name <> ''
     GROUP BY state_code, cost_company_name`,
    [FINANCE_YEAR, FINANCE_YEAR],
  );
  const [legacyPi] = await billQuery<RowDataPacket>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(proforma_bill_no,'/',-1) AS UNSIGNED)) AS max_pi
     FROM tbl_invoice WHERE proforma_bill_no LIKE 'PI/%'`,
  );
  const [seqRows] = await db.query<RowDataPacket[]>(
    "SELECT kind, scope_key, `last_value` AS v FROM client_invoice_number_sequence",
  );
  const current = new Map(seqRows.map((r) => [`${r.kind}::${r.scope_key}`, Number(r.v)]));

  const plans: Plan[] = [];
  const legacyByKey = new Map<string, number>();
  for (const r of legacyBills) {
    const scopeKey = counterScopeKey(String(r.state_code), String(r.company), FINANCE_YEAR);
    legacyByKey.set(scopeKey, Math.max(legacyByKey.get(scopeKey) ?? 0, Number(r.max_idx ?? 0)));
  }
  for (const [scopeKey, legacy] of legacyByKey) {
    const hrms = current.get(`bill::${scopeKey}`) ?? null;
    plans.push({ kind: "bill", scopeKey, hrms, legacy, target: Math.max(hrms ?? 0, legacy) });
  }
  const piLegacy = Number(legacyPi?.max_pi ?? 0);
  const piHrms = current.get("proforma::GLOBAL") ?? null;
  plans.push({ kind: "proforma", scopeKey: "GLOBAL", hrms: piHrms, legacy: piLegacy, target: Math.max(piHrms ?? 0, piLegacy) });

  console.log(`\nMODE=${MODE} FINANCE_YEAR=${FINANCE_YEAR}`);
  console.table(plans.map((p) => ({ ...p, change: p.target > (p.hrms ?? 0) ? `raise to ${p.target}` : "none" })));

  // Numbers HRMS already issued live that also exist in I-Spark (duplicates already out there).
  const [live] = await db.query<RowDataPacket[]>(
    `SELECT ci.bill_no, ci.proforma_no, ci.invoice_status, DATE_FORMAT(ci.created_at,'%Y-%m-%d') AS created,
            cc.cost_centre_code, cc.company_name
     FROM client_invoice ci LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     WHERE ci.is_migrated = 0`,
  );
  for (const r of live) {
    const clashes = r.bill_no
      ? await billQuery<RowDataPacket>(
          `SELECT id, cost_center, cost_company_name, DATE_FORMAT(createdate,'%Y-%m-%d') AS created, grnd
           FROM tbl_invoice WHERE bill_no = ?`, [r.bill_no])
      : [];
    console.log(`\nHRMS live ${r.bill_no ?? "-"} / ${r.proforma_no} (${r.invoice_status}, ${r.cost_centre_code}, ${r.company_name}, ${r.created}): ${clashes.length} legacy bill(s) with the same number`);
    if (clashes.length) console.table(clashes);
  }

  if (MODE !== "apply") { console.log("\nDry run: nothing written."); return; }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of plans) {
      if (p.target <= (p.hrms ?? 0)) continue;
      await conn.execute(
        `INSERT INTO client_invoice_number_sequence (kind, scope_key, \`last_value\`, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE \`last_value\` = GREATEST(\`last_value\`, VALUES(\`last_value\`)), updated_at = NOW()`,
        [p.kind, p.scopeKey, p.target],
      );
      console.log(`raised ${p.kind} ${p.scopeKey} -> ${p.target}`);
    }
    await conn.commit();
    console.log("\nApplied.");
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
