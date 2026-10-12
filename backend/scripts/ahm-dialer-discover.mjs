/**
 * AHM call data discovery, step 2 -- read-only production diagnosis.
 *   node scripts/ahm-dialer-discover.mjs
 * Step 1 showed dialer_db holds per-project outbound CDR tables (cdr_ob_<id>: Agent, PhoneNumber, CallDate, LengthInSec,
 * CallStatus, talk_sec, campaign_id) and vicidial_agent_log_<id>. This finds which of them AHM's telesales agents dial from, by
 * matching the Telesales IDs in db_masmis.ahm_dump_raw against each table's Agent column, then profiles the best match.
 * READ ONLY sessions, SELECTs only, every probe time-boxed. Prints agent ids only as counts and a few samples.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const main = await mysql.createConnection({
  host: strip(process.env.DB_HOST), port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME),
  connectTimeout: 20000, dateStrings: true,
});
const dialer = await mysql.createConnection({
  host: strip(process.env.DIALER_DB_HOST) || strip(process.env.DB_HOST), port: Number(strip(process.env.DIALER_DB_PORT) || 3306),
  user: strip(process.env.DIALER_DB_USER), password: strip(process.env.DIALER_DB_PASSWORD), database: strip(process.env.DIALER_DB_NAME),
  connectTimeout: 20000, dateStrings: true,
});
const schema = strip(process.env.DIALER_DB_NAME);
const out = (t, rows) => { console.log(`\n## ${t}`); for (const r of rows) console.log(JSON.stringify(r)); if (!rows.length) console.log("(none)"); };
const q = async (c, t, sql, params = []) => { try { const [r] = await c.query(sql, params); out(t, r); return r; } catch (e) { out(t, [{ ERROR: `${e.code ?? ""} ${e.message}` }]); return []; } };
try {
  await main.query("SET SESSION TRANSACTION READ ONLY");
  await dialer.query("SET SESSION TRANSACTION READ ONLY");
  await dialer.query("SET SESSION MAX_EXECUTION_TIME = 30000");

  const ids = (await q(main, "AHM dump: telesales ids (count + sample + date range)",
    `SELECT COUNT(DISTINCT telesales_id) agents, MIN(survey_date) first_day, MAX(survey_date) last_day,
            SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT telesales_id ORDER BY telesales_id SEPARATOR ','), ',', 6) sample
       FROM db_masmis.ahm_dump_raw WHERE telesales_id IS NOT NULL AND telesales_id <> ''`));
  const [idRows] = await main.query(`SELECT DISTINCT LOWER(TRIM(telesales_id)) id FROM db_masmis.ahm_dump_raw WHERE telesales_id IS NOT NULL AND TRIM(telesales_id) <> '' LIMIT 2000`);
  const agentIds = idRows.map((r) => r.id);
  console.log(`\n(ahm telesales ids loaded: ${agentIds.length})`);
  if (!agentIds.length) process.exit(0);

  const [tbl] = await dialer.query(
    `SELECT TABLE_NAME t FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        AND (TABLE_NAME REGEXP '^cdr_ob_[0-9_]+$' OR TABLE_NAME REGEXP '^vicidial_agent_log_[0-9_]+$') ORDER BY TABLE_NAME`, [schema]);
  const ph = agentIds.map(() => "?").join(",");
  const scores = [];
  for (const { t } of tbl) {
    const isCdr = t.startsWith("cdr_ob_");
    const agentCol = isCdr ? "Agent" : "`user`";
    const dateCol = isCdr ? "CallDate" : "event_time";
    try {
      const [[r]] = await dialer.query(
        `SELECT COUNT(*) calls, COUNT(DISTINCT ${agentCol}) agents, MIN(${dateCol}) first_seen, MAX(${dateCol}) last_seen
           FROM \`${t}\` WHERE ${dateCol} >= '2026-09-25' AND LOWER(TRIM(${agentCol})) IN (${ph})`, agentIds);
      scores.push({ table: t, ...r });
    } catch (e) { scores.push({ table: t, ERROR: `${e.code ?? ""} ${e.message}`.slice(0, 80) }); }
  }
  out("tables ranked by AHM-agent matches since 2026-09-25", scores.sort((a, b) => Number(b.agents ?? -1) - Number(a.agents ?? -1)));

  const best = scores.filter((s) => s.table?.startsWith("cdr_ob_") && Number(s.agents) > 0).sort((a, b) => Number(b.agents) - Number(a.agents))[0];
  if (best) {
    const t = best.table;
    await q(dialer, `${t}: sample rows (matched agents)`,
      `SELECT Agent, PhoneNumber, CallDate, StartTime, LengthInSec, CallStatus, talk_sec, campaign_id, term_reason
         FROM \`${t}\` WHERE CallDate >= '2026-10-01' AND LOWER(TRIM(Agent)) IN (${ph}) ORDER BY CallDate DESC, StartTime DESC LIMIT 8`, agentIds);
    await q(dialer, `${t}: CallStatus mix (matched agents, since 2026-10-01)`,
      `SELECT CallStatus, COUNT(*) n, ROUND(AVG(talk_sec),1) avg_talk, SUM(talk_sec > 0) with_talk
         FROM \`${t}\` WHERE CallDate >= '2026-10-01' AND LOWER(TRIM(Agent)) IN (${ph}) GROUP BY CallStatus ORDER BY n DESC LIMIT 30`, agentIds);
    await q(dialer, `${t}: campaign_id mix (matched agents, since 2026-10-01)`,
      `SELECT campaign_id, COUNT(*) n, COUNT(DISTINCT Agent) agents FROM \`${t}\`
        WHERE CallDate >= '2026-10-01' AND LOWER(TRIM(Agent)) IN (${ph}) GROUP BY campaign_id ORDER BY n DESC LIMIT 15`, agentIds);
    await q(dialer, `${t}: all-agent campaign_id mix since 2026-10-01 (is the table AHM-only?)`,
      `SELECT campaign_id, COUNT(*) n, COUNT(DISTINCT Agent) agents FROM \`${t}\` WHERE CallDate >= '2026-10-01' GROUP BY campaign_id ORDER BY n DESC LIMIT 15`);
    await q(dialer, `${t}: daily calls (matched agents)`,
      `SELECT CallDate d, COUNT(*) calls, COUNT(DISTINCT Agent) agents FROM \`${t}\`
        WHERE CallDate >= '2026-09-25' AND LOWER(TRIM(Agent)) IN (${ph}) GROUP BY CallDate ORDER BY CallDate`, agentIds);
  }
} finally {
  await main.end(); await dialer.end();
}
