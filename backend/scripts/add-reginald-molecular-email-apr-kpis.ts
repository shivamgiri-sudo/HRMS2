/**
 * Real gap found 2026-09-11 reading the real "Reginald_Men_Email_Dashboard_
 * SOP_UPDATED.xlsx" / "Molecular_Email_Dashboard_SOP_UPDATED.xlsx" (Analyst
 * APR tab, identical in both files): both dashboards' Analyst Productivity
 * section is sourced from "Vicidial – Agent Time Detail
 * (dialer_db.vicidial_agent_log_10_25), Exact Campaign = Email" -- a real,
 * live table (1,423,140 rows, current through today) already reachable via
 * dialer_db, with ZERO KPI Studio wiring for either brand (only the sibling
 * BELLA_AGENT_LOG source existed for Bella-Vita's own vicidial_agent_log_
 * 11_5). email_ticket_daily_actual (the OTHER half of these dashboards,
 * ticket volume/closure/reopen) is already fully built with real upload
 * templates + KPI wiring for both EMAIL_TICKETS_REGINALD_MEN and
 * EMAIL_TICKETS_MOLECULAR -- just 0 rows, awaiting a real upload, not a
 * code gap. This script adds only the missing APR half.
 *
 * Real campaign_id values confirmed live: 'EMAIL' (Reginald Men),
 * 'MOEMAIL' (Molecular). Real sub_status values confirmed live: LOGIN,
 * LAGGED, LB, TB, WB, MB, DISMX -- an exact match for the SOP's own break-
 * bucket names (LB/TB/WB/MB), no fuzzy text matching needed.
 *
 * Both Reginald Men and Molecular email dashboards attach to the single
 * "Reginald" process_master row (confirmed: EMAIL_TICKETS_MOLECULAR and
 * EMAIL_TICKETS_REGINALD_MEN both already use this same process_id,
 * distinguished by dashboard_label on their own table) -- following that
 * exact established convention here too.
 *
 * Deliberately NOT built: "Calls" (COUNT) and downstream ACHT/Utilization,
 * which need a call-count definition this table's event-log grain (one row
 * per pause/wait/talk/dispo cycle, not one row per call) does not make
 * unambiguous, and the SOP's own "Productive Time" isn't independently
 * defined. Built only what the raw seconds fields make certain: LOGIN TIME,
 * WAIT/TALK/DISPO/PAUSE, the LB/TB/WB break buckets, Total Break and Net
 * Login Hrs+DN -- exactly the formulas the SOP states without needing a
 * guessed denominator.
 *
 * Run with: npx tsx scripts/add-reginald-molecular-email-apr-kpis.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface Ref extends RowDataPacket { id: string }

const BRANDS = [
  { prefix: "REGINALD_MEN_EMAIL", label: "Reginald Men Email", campaignId: "EMAIL" },
  { prefix: "MOLECULAR_EMAIL", label: "Molecular Email", campaignId: "MOEMAIL" },
] as const;

async function main() {
  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Reginald' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id;
  if (!processId) throw new Error('No active process found named "Reginald"');
  console.log(`Process: Reginald (${processId})`);

  for (const brand of BRANDS) {
    const sourceId = randomUUID();
    await db.execute(
      `INSERT INTO kpi_studio_data_source
         (id, source_code, source_name, source_type, integration_key, source_object,
          employee_key_column, employee_key_kind, date_column, date_format, config_json,
          description, active_status, created_by, process_key_kind, process_key_column,
          process_key_value, process_id)
       VALUES (?, ?, ?, 'local_query', NULL, 'dialer_db.vicidial_agent_log_10_25',
               'user', 'employee_code', 'event_time', NULL, NULL, ?, 1, 'demo-super-admin-id',
               'constant', NULL, NULL, ?)`,
      [
        sourceId, `${brand.prefix}_APR`, `${brand.label} agent activity (dialer)`,
        `ViciDial agent event log, campaign_id='${brand.campaignId}'. Per the real ${brand.label} Dashboard SOP's own Analyst APR tab (Exact Campaign = ${brand.label === "Reginald Men Email" ? "Email" : "MOEmail"}).`,
        processId,
      ],
    );
    console.log(`${brand.prefix}: created data source ${brand.prefix}_APR (${sourceId})`);

    const baseFilter = [{ op: "eq", value: brand.campaignId, column: "campaign_id" }];
    const fields: Array<{ name: string; display: string; column: string; extraFilter?: unknown }> = [
      { name: "wait_sec", display: "Wait seconds", column: "wait_sec" },
      { name: "talk_sec", display: "Talk seconds", column: "talk_sec" },
      { name: "dispo_sec", display: "Dispo seconds", column: "dispo_sec" },
      { name: "pause_sec", display: "Total pause seconds", column: "pause_sec" },
      { name: "lb_sec", display: "Lunch Break seconds", column: "pause_sec", extraFilter: { op: "eq", value: "LB", column: "sub_status" } },
      { name: "tb_sec", display: "Tea Break seconds", column: "pause_sec", extraFilter: { op: "eq", value: "TB", column: "sub_status" } },
      { name: "wb_sec", display: "Wash/Water/Bio Break seconds", column: "pause_sec", extraFilter: { op: "eq", value: "WB", column: "sub_status" } },
      { name: "mb_sec", display: "Meeting Break seconds", column: "pause_sec", extraFilter: { op: "eq", value: "MB", column: "sub_status" } },
    ];
    for (const f of fields) {
      const filterJson = f.extraFilter ? [...baseFilter, f.extraFilter] : baseFilter;
      await db.execute(
        `INSERT INTO kpi_studio_source_field
           (id, data_source_id, field_name, display_name, source_column, aggregate_fn,
            source_expression, filter_json, unit, description, active_status)
         VALUES (?, ?, ?, ?, ?, 'SUM', NULL, ?, 'seconds', NULL, 1)`,
        [randomUUID(), sourceId, f.name, f.display, f.column, JSON.stringify(filterJson)],
      );
    }
    console.log(`  ${fields.length} fields created`);

    // lb_sec/tb_sec/wb_sec/mb_sec are wrapped in COALESCE(...,0): the formula engine
    // propagates null rather than zero for a missing input (by design -- see kpi-formula-
    // engine.ts's own top-of-file doc), but a day with genuinely zero WB/MB break events
    // (confirmed live for Molecular: wb_sec and mb_sec both legitimately 0 across the
    // whole verification window) is a real zero, not "unmeasured" -- without COALESCE these
    // three formulas returned null for Molecular even though every input was real.
    const metrics: Array<{ code: string; name: string; formula: string }> = [
      { code: `${brand.prefix}_LOGIN_TIME_SEC`, name: `${brand.label} Login Time (sec)`, formula: "wait_sec + talk_sec + dispo_sec + pause_sec" },
      { code: `${brand.prefix}_TOTAL_BREAK_SEC`, name: `${brand.label} Total Break (LB+TB+WB, sec)`, formula: "COALESCE(lb_sec,0) + COALESCE(tb_sec,0) + COALESCE(wb_sec,0)" },
      { code: `${brand.prefix}_NET_LOGIN_SEC`, name: `${brand.label} Net Login Hrs+DN (sec)`, formula: "(wait_sec + talk_sec + dispo_sec + pause_sec) - (COALESCE(lb_sec,0) + COALESCE(tb_sec,0) + COALESCE(wb_sec,0))" },
      { code: `${brand.prefix}_ACTUAL_LOGIN_SEC`, name: `${brand.label} Actual Login Hrs (sec)`, formula: "(wait_sec + talk_sec + dispo_sec + pause_sec) - (COALESCE(lb_sec,0) + COALESCE(tb_sec,0) + COALESCE(wb_sec,0)) - COALESCE(mb_sec,0)" },
    ];
    for (const m of metrics) {
      const metricId = randomUUID();
      await db.execute(
        `INSERT INTO kpi_metric_master
           (id, metric_code, metric_name, family, category, unit, direction, scoring_type,
            aggregation_method, decimal_places, active_status)
         VALUES (?, ?, ?, 'custom', 'custom', 'seconds', 'higher_is_better', NULL, 'sum', 0, 1)`,
        [metricId, m.code, m.name],
      );
      const defId = randomUUID();
      await db.execute(
        `INSERT INTO kpi_studio_definition
           (id, metric_id, grain, process_id, data_source_id, formula_expression,
            aggregation_method, scoring_type, effective_from, active_status, created_by)
         VALUES (?, ?, 'process', ?, ?, ?, 'sum', 'raw', CURDATE(), 1, 'demo-super-admin-id')`,
        [defId, metricId, processId, sourceId, m.formula],
      );
      console.log(`  metric ${m.code} (${metricId}) + definition (${defId})`);
    }
  }

  console.log("\nDone. 2 data sources, 16 fields, 8 metrics + definitions created.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED", e); process.exit(1); });
