// SALES_COUNT read a per-client "bb_sale"/"gnc_sale"/"neemans_sale_raw"-style
// manually-uploaded table that stopped updating months ago (bb_sale: last
// row 2026-06-29). The AI funnel already computes a live "sold" signal
// (sale_done=1) from the exact same call-quality audit data FUNNEL_SALE_PCT
// already uses -- re-point SALES_COUNT at that instead, per processes own
// funnel data source (each process has its own, magical_script_cache scoped
// to its own ClientId).
//
// User's explicit choice: switch to the live AI-funnel signal (not "leave
// stale" or "skip"), accepting this changes SALES_COUNT's meaning from
// "confirmed order count" to "AI-detected sale-closed count" -- the only
// live source available now that the upload feed is dead.
import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306, database: process.env.DB_NAME,
});

const [salesDefs] = await conn.query(
  `SELECT d.id, d.process_id, p.process_name
     FROM kpi_studio_definition d
     JOIN kpi_metric_master m ON m.id = d.metric_id
     JOIN process_master p ON p.id = d.process_id
    WHERE m.metric_code = 'SALES_COUNT' AND d.active_status = 1`
);

const results = [];
for (const def of salesDefs) {
  const [funnelDef] = await conn.query(
    `SELECT d.data_source_id
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
      WHERE m.metric_code = 'FUNNEL_SALE_PCT' AND d.process_id = ? AND d.active_status = 1
      LIMIT 1`,
    [def.process_id],
  );
  if (!funnelDef.length) {
    results.push({ process: def.process_name, skipped: "no FUNNEL_SALE_PCT data source for this process to reuse" });
    continue;
  }
  const funnelDataSourceId = funnelDef[0].data_source_id;

  const [soldField] = await conn.query(
    `SELECT field_name FROM kpi_studio_source_field WHERE data_source_id = ? AND field_name = 'sold'`,
    [funnelDataSourceId],
  );
  if (!soldField.length) {
    results.push({ process: def.process_name, skipped: "funnel data source has no 'sold' field" });
    continue;
  }

  await conn.query(
    `UPDATE kpi_studio_definition
        SET data_source_id = ?, formula_expression = 'sold',
            notes = CONCAT(COALESCE(notes,''), ' | Re-pointed from a stale manual-upload table (bb_sale-style, dead since ~2026-06) to the live AI funnels own sale_done signal, same data FUNNEL_SALE_PCT already reads.')
      WHERE id = ?`,
    [funnelDataSourceId, def.id],
  );
  results.push({ process: def.process_name, fixed: true, newDataSource: funnelDataSourceId });
}

console.log(JSON.stringify(results, null, 2));
await conn.end();
