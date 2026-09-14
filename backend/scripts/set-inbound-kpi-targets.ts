/**
 * Real gap, found 2026-09-10 auditing "Inbound Code for all process.txt" (the
 * live Google Apps Script that has emailed these exact process owners a daily
 * pass/fail dashboard for GNC/Bellavita/Clovia/Neemans/Viega/Exicom/DU
 * Bangladesh for a long time): the AL%/SL%/ACHT KPIs already computing live
 * in HRMS2's KPI Studio (INBOUND_AL_PCT, INBOUND_SL_PCT, INBOUND_*_ACHT) had
 * target_value/min_threshold = NULL, so KpiInsightBoard.tsx and friends had
 * no target to compare against -- the dashboard showed raw numbers with no
 * green/red signal, even though the business's own daily email has always
 * used AL>=95%, SL>=80%, ACHT<=300s as the bar.
 *
 * User approved AL/SL/ACHT (not Repeat%, which the source script is
 * internally inconsistent about -- 10% in one table, 20% in another -- and
 * not FCR, out of scope this round).
 *
 * Run with: npx tsx scripts/set-inbound-kpi-targets.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const PROCESSES = ["GNC", "Viega", "Exicom", "DU Digital", "Clovia", "Neemans Private Limited"];

async function setTarget(metricCode: string, targetValue: number, label: string) {
  const placeholders = PROCESSES.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sd.id, pm.process_name, sd.target_value
       FROM kpi_studio_definition sd
       JOIN kpi_metric_master mm ON mm.id = sd.metric_id
       LEFT JOIN process_master pm ON pm.id = sd.process_id
      WHERE mm.metric_code = ? AND sd.active_status = 1 AND pm.process_name IN (${placeholders})`,
    [metricCode, ...PROCESSES],
  );
  console.log(`${label} (${metricCode}): found ${rows.length} rows`);
  for (const r of rows) {
    await db.execute(`UPDATE kpi_studio_definition SET target_value = ? WHERE id = ?`, [targetValue, r.id]);
    console.log(`  ${r.process_name}: ${r.target_value ?? "NULL"} -> ${targetValue}`);
  }
  return rows.length;
}

async function setAchtTargets(targetValue: number) {
  const codeByProcess: Record<string, string> = {
    "GNC": "INBOUND_GNC_ACHT",
    "Viega": "INBOUND_VIEGA_ACHT",
    "Exicom": "INBOUND_EXICOM_ACHT",
    "DU Digital": "INBOUND_DU_BANGLADESH_ACHT",
    "Clovia": "INBOUND_CLOVIA_ACHT",
    "Neemans Private Limited": "INBOUND_NEEMANS_ACHT",
  };
  let count = 0;
  for (const [processName, metricCode] of Object.entries(codeByProcess)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sd.id, sd.target_value
         FROM kpi_studio_definition sd
         JOIN kpi_metric_master mm ON mm.id = sd.metric_id
         LEFT JOIN process_master pm ON pm.id = sd.process_id
        WHERE mm.metric_code = ? AND sd.active_status = 1 AND pm.process_name = ?`,
      [metricCode, processName],
    );
    for (const r of rows) {
      await db.execute(`UPDATE kpi_studio_definition SET target_value = ? WHERE id = ?`, [targetValue, r.id]);
      console.log(`  ACHT ${processName}: ${r.target_value ?? "NULL"} -> ${targetValue}`);
      count++;
    }
  }
  return count;
}

async function main() {
  let total = 0;
  total += await setTarget("INBOUND_AL_PCT", 95, "Answer Level %");
  total += await setTarget("INBOUND_SL_PCT", 80, "Service Level %");
  total += await setAchtTargets(300);
  console.log(`\nTotal targets set: ${total}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED", e); process.exit(1); });
