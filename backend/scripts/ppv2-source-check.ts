/**
 * Read-only: where Process Performance V2 gets its data. Reports (1) which servers the main, db_masmis-external and dialer
 * connections really reach (server uuid prefix + version only - no hosts, no credentials), (2) whether the cross-schema read
 * the V2 services use (main connection -> db_masmis.<table>) works, and (3) per source table: rows, newest load time and rows
 * loaded in the last 7 days (freshness). No row content is printed.
 */
import "dotenv/config";
import type { Pool } from "mysql2/promise";
import { db } from "../src/db/mysql.js";
import { getDialerPool } from "../src/db/dialerDb.js";
import { getPoolForKey } from "../src/modules/external-db/external-db.service.js";

const MASMIS = [
  "bb_sale", "bb_apr", "bb_chat", "new_bb_chat", "bb_cart", "bvo_repeat_allocation", "gnc_sale", "gnc_allocation", "gnc_apr", "gnc_chat",
  "neemans_sale_raw", "neemans_allocation", "neemans_apr", "neemans_chat", "neemans_cart", "aw_billing", "aw_out", "aw_inbound", "aw_new_cdr",
  "aw_mandate", "owner_sale", "Owner_cdr", "owner_agent_details", "pre_sale", "Pre_cdr", "pre_agent_details", "cl_apr", "cl_chat", "cl_dispo",
  "cl_email_raw", "cl_feedback", "cl_ib_cdr", "cl_outbound", "cl_quality", "cl_rechurn_call", "birlanu_sale", "birlanu_apr", "satya_allocation",
  "satya_cdr", "lp_feedback_apr", "lp_feedback_cdr", "lp_onboarding_apr", "lp_onboarding_cdr", "dalmia_dd_raw", "dalmia_outbound_raw",
  "dalmia_apr_raw", "dalmia_after_hour_raw",
];
const HRMS = ["sbi_card_dialer_mis", "sbi_card_agent_mis", "sbi_card_account_file", "gnc_lob_target"];
const DIALER = ["cdr_in_4", "cdr_in_11_5", "cdr_in_250", "cdr_in_249", "cdr_in_9", "cdr_in_10_4"];

type Q = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;
const viaPool = (p: Pool): Q => async (sql, params) => (await p.execute(sql, params as never[]))[0] as Array<Record<string, unknown>>;
const viaMain: Q = async (sql, params) => (await db.execute(sql, params as never[]))[0] as Array<Record<string, unknown>>;

async function identity(label: string, q: Q) {
  try {
    const [r] = await q("SELECT LEFT(@@server_uuid, 8) AS uuid, @@version AS ver, DATABASE() AS cur, @@port AS port");
    console.log(`server | ${label} | uuid ${r.uuid} | mysql ${r.ver} | default db ${r.cur ?? "(none)"} | port ${r.port}`);
  } catch (e) { console.log(`server | ${label} | FAILED ${e instanceof Error ? e.message : e}`); }
}

async function freshness(label: string, q: Q, schema: string, tables: string[]) {
  for (const t of tables) {
    try {
      const cols = await q(`SELECT COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [schema, t]);
      if (!cols.length) { console.log(`fresh | ${label} | ${t} | NOT FOUND in ${schema}`); continue; }
      const pick = ["inserted_at", "uploaded_at", "created_at"].map((n) => cols.find((c) => String(c.c).toLowerCase() === n)).find(Boolean)
        ?? cols.find((c) => ["datetime", "timestamp", "date"].includes(String(c.d)));
      const [cnt] = await q(`SELECT COUNT(*) AS n FROM \`${schema}\`.\`${t}\``);
      if (!pick) { console.log(`fresh | ${label} | ${t} | rows ${cnt.n} | (no load-time column)`); continue; }
      const col = String(pick.c);
      const [m] = await q(`SELECT MAX(\`${col}\`) AS newest, SUM(\`${col}\` >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS last7 FROM \`${schema}\`.\`${t}\``);
      const newest = m.newest ? new Date(m.newest as string).toISOString().slice(0, 16).replace("T", " ") : "-";
      console.log(`fresh | ${label} | ${t} | rows ${cnt.n} | newest ${col}=${newest} | loaded last 7d ${m.last7 ?? 0}`);
    } catch (e) { console.log(`fresh | ${label} | ${t} | FAILED ${e instanceof Error ? e.message : e}`); }
  }
}

async function main() {
  await identity("main connection (mas_hrms)", viaMain);
  let ext: Pool | null = null;
  try { ext = (await getPoolForKey("sales_brand_mis")) as Pool; await identity("external 'sales_brand_mis' (db_masmis)", viaPool(ext)); }
  catch (e) { console.log(`server | external 'sales_brand_mis' | FAILED ${e instanceof Error ? e.message : e}`); }
  let dialer: Pool | null = null;
  try { dialer = await getDialerPool(); await identity("dialer connection (dialer_db)", viaPool(dialer)); }
  catch (e) { console.log(`server | dialer | FAILED ${e instanceof Error ? e.message : e}`); }

  try { const [r] = await viaMain("SELECT COUNT(*) AS n FROM db_masmis.gnc_sale"); console.log(`path | main connection -> db_masmis.gnc_sale (what V2 services do): OK, ${r.n} rows`); }
  catch (e) { console.log(`path | main connection -> db_masmis.gnc_sale: FAILED ${e instanceof Error ? e.message : e}`); }

  await freshness("db_masmis via main", viaMain, "db_masmis", MASMIS);
  await freshness("mas_hrms", viaMain, "mas_hrms", HRMS);
  if (dialer) await freshness("dialer_db", viaPool(dialer), "dialer_db", DIALER);
}
main().catch((e) => { console.error("check failed:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await (db as unknown as { end?: () => Promise<void> }).end?.(); process.exit(); });
