/**
 * Read-only: where do the people who actually work each process sit in HRMS?
 * Takes the agent codes found in each process's own upload table (last 60 days) and looks them up in HRMS through every
 * assignment route: employees.process_id, the cost centre's process, and LOB assignment. Aggregates only - no names/codes.
 */
import "dotenv/config";
import type { Pool } from "mysql2/promise";
import { db } from "../src/db/mysql.js";
import { getPoolForKey } from "../src/modules/external-db/external-db.service.js";

type Src = { process: string; label: string; pool: "masmis" | "hrms"; sql: string };
const SOURCES: Src[] = [
  { process: "gnc", label: "gnc_apr.emp_id", pool: "masmis", sql: `SELECT DISTINCT UPPER(TRIM(emp_id)) AS c FROM db_masmis.gnc_apr WHERE emp_id IS NOT NULL AND TRIM(emp_id) <> '' AND STR_TO_DATE(report_date, '%e-%b-%y') >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)` },
  { process: "gnc", label: "gnc_sale.emp_id", pool: "masmis", sql: `SELECT DISTINCT UPPER(TRIM(emp_id)) AS c FROM db_masmis.gnc_sale WHERE emp_id IS NOT NULL AND TRIM(emp_id) <> '' AND sale_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)` },
  { process: "satya_retail", label: "satya_allocation.agent_id", pool: "masmis", sql: `SELECT DISTINCT UPPER(TRIM(agent_id)) AS c FROM db_masmis.satya_allocation WHERE agent_id IS NOT NULL AND TRIM(agent_id) <> ''` },
  { process: "satya_retail", label: "satya_cdr.agent_id", pool: "masmis", sql: `SELECT DISTINCT UPPER(TRIM(agent_id)) AS c FROM db_masmis.satya_cdr WHERE agent_id IS NOT NULL AND TRIM(agent_id) <> ''` },
  { process: "housing_owner", label: "owner_sale.agent_id", pool: "masmis", sql: `SELECT DISTINCT UPPER(TRIM(agent_id)) AS c FROM db_masmis.owner_sale WHERE agent_id IS NOT NULL AND TRIM(agent_id) <> ''` },
  { process: "housing_premium", label: "pre_sale.agent_id", pool: "masmis", sql: `SELECT DISTINCT UPPER(TRIM(agent_id)) AS c FROM db_masmis.pre_sale WHERE agent_id IS NOT NULL AND TRIM(agent_id) <> ''` },
  { process: "sbi_card", label: "sbi_card_agent_mis.employee_id", pool: "hrms", sql: `SELECT DISTINCT UPPER(TRIM(employee_id)) AS c FROM sbi_card_agent_mis WHERE employee_id IS NOT NULL AND TRIM(employee_id) <> ''` },
  { process: "neemans (control)", label: "neemans_apr.emp_id", pool: "masmis", sql: `SELECT DISTINCT UPPER(TRIM(emp_id)) AS c FROM db_masmis.neemans_apr WHERE emp_id IS NOT NULL AND TRIM(emp_id) <> ''` },
];

async function main() {
  const masmis = (await getPoolForKey("sales_brand_mis")) as Pool;
  for (const s of SOURCES) {
    let codes: string[] = [];
    try {
      const [rows] = s.pool === "masmis" ? await masmis.execute(s.sql) : await db.execute(s.sql);
      codes = (rows as Array<{ c: string }>).map((r) => r.c).filter(Boolean);
    } catch (e) {
      console.log(`trace | ${s.process} | ${s.label} | QUERY FAILED: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (!codes.length) { console.log(`trace | ${s.process} | ${s.label} | no agent codes in source`); continue; }
    const ph = codes.map(() => "?").join(",");
    const [emps] = await db.execute(
      `SELECT e.id, e.active_status AS active, pm.process_code AS p_code, ccp.process_code AS cc_code,
              (SELECT GROUP_CONCAT(DISTINCT plp.process_code) FROM employee_lob_assignment ela
                 JOIN process_lob_master plm ON plm.id = ela.process_lob_id
                 JOIN process_master plp ON plp.id = plm.process_id
                WHERE ela.employee_id = e.id AND ela.status = 'active') AS lob_codes
         FROM employees e
         LEFT JOIN process_master pm ON pm.id = e.process_id
         LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
         LEFT JOIN process_master ccp ON ccp.id = cc.process_id
        WHERE UPPER(TRIM(e.employee_code)) IN (${ph})`, codes as never[]);
    const list = emps as Array<{ active: number; p_code: string | null; cc_code: string | null; lob_codes: string | null }>;
    const act = list.filter((e) => e.active === 1);
    const tally = (f: (e: (typeof list)[number]) => string) => {
      const m = new Map<string, number>();
      for (const e of act) m.set(f(e), (m.get(f(e)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}=${n}`).join(", ");
    };
    console.log(`trace | ${s.process} | ${s.label} | source agents ${codes.length} | in HRMS ${list.length} | active ${act.length}`);
    console.log(`  by employees.process_id : ${tally((e) => e.p_code ?? "(none)")}`);
    console.log(`  by cost centre process  : ${tally((e) => e.cc_code ?? "(none)")}`);
    console.log(`  by LOB assignment       : ${tally((e) => e.lob_codes ?? "(none)")}`);
  }
}

main().catch((e) => { console.error("trace failed:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await (db as unknown as { end?: () => Promise<void> }).end?.(); process.exit(); });
