/**
 * Read-only: column names, row counts and the shape (not content) of the first non-empty value of the date-like columns,
 * for the db_masmis upload tables the next KPI feeds read. No personal data is printed.
 */
import "dotenv/config";
import type { Pool } from "mysql2/promise";
import { db } from "../src/db/mysql.js";
import { getPoolForKey } from "../src/modules/external-db/external-db.service.js";

const TABLES = [
  "owner_sale", "owner_agent_details", "Owner_cdr", "pre_sale", "pre_agent_details", "Pre_cdr",
  "satya_allocation", "satya_cdr", "aw_billing", "aw_out", "aw_inbound", "cl_chat", "cl_outbound", "gnc_sale", "gnc_apr", "gnc_chat",
];
const shape = (v: unknown) => String(v ?? "").replace(/[A-Za-z]/g, "a").replace(/\d/g, "9").slice(0, 24);

async function main() {
  const pool = (await getPoolForKey("sales_brand_mis")) as Pool;
  for (const t of TABLES) {
    try {
      const [cols] = await pool.execute(`SELECT COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'db_masmis' AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [t]);
      const list = cols as Array<{ c: string; d: string }>;
      if (!list.length) { console.log(`peek | ${t} | NOT FOUND`); continue; }
      const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM db_masmis.\`${t}\``);
      console.log(`peek | ${t} | rows ${(cnt as Array<{ n: number }>)[0].n} | cols: ${list.map((x) => `${x.c}:${x.d}`).join(", ")}`);
      const dateCols = list.filter((x) => /date|time|^day$|month|week/i.test(x.c)).slice(0, 4);
      for (const dc of dateCols) {
        const [s] = await pool.execute(`SELECT \`${dc.c}\` AS v FROM db_masmis.\`${t}\` WHERE \`${dc.c}\` IS NOT NULL AND TRIM(CAST(\`${dc.c}\` AS CHAR)) <> '' ORDER BY id DESC LIMIT 1`).catch(() => [[]] as never);
        const v = (s as Array<{ v: unknown }>)[0]?.v;
        if (v !== undefined) console.log(`  shape | ${t}.${dc.c} | ${shape(v)}`);
      }
      const idCols = list.filter((x) => /emp|agent|user|mas|code/i.test(x.c)).slice(0, 5);
      for (const ic of idCols) {
        const [s] = await pool.execute(`SELECT \`${ic.c}\` AS v FROM db_masmis.\`${t}\` WHERE \`${ic.c}\` IS NOT NULL AND TRIM(CAST(\`${ic.c}\` AS CHAR)) <> '' ORDER BY id DESC LIMIT 1`).catch(() => [[]] as never);
        const v = (s as Array<{ v: unknown }>)[0]?.v;
        if (v !== undefined) console.log(`  idshape | ${t}.${ic.c} | ${shape(v)}`);
      }
    } catch (e) {
      console.log(`peek | ${t} | FAILED ${e instanceof Error ? e.message : e}`);
    }
  }
}
main().catch((e) => { console.error("peek failed:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await (db as unknown as { end?: () => Promise<void> }).end?.(); process.exit(); });
