/**
 * Real gap found 2026-09-11 reading Bhavesh Dayal's real "Dashboard SOP
 * Formulation Inbound & ABC with Sales Mapping.xlsx" (Abandoned Cart Sales
 * tab): `bla_bli_blu_overall_sales_raw` (sql/1729) already carries 2400 real
 * rows with the SOP's own Real-Time/Same-Day-PTP/24-Hour-PTP classification
 * pre-computed in `business_type` (confirmed live: all 3 values present with
 * real distinct calling_status combinations) -- but has ZERO KPI Studio
 * wiring (kpi_studio_data_source query returned empty). The classification
 * work the SOP describes is already done upstream of the upload; only the
 * KPI layer on top of it was missing.
 *
 * Adds 6 metrics matching the SOP's own formulas exactly (Sr. No. 13, 17,
 * 18, 20, 21, 23, 25, 28 in the Abandoned Cart Sales tab):
 * - BLA_ABC_SALES_COUNT: COUNTIFS(..., Sale Type='Real Time Sales')
 * - BLA_ABC_REVENUE: SUMIFS(revenue, ..., Sale Type='Real Time Sales')
 * - BLA_ABC_AOV: Revenue / BAU Sales
 * - BLA_ABC_PTP_SAMEDAY_COUNT: COUNTIFS(..., Sale Type='Same Day PTP')
 * - BLA_ABC_PTP_24HR_COUNT: COUNTIFS(..., Sale Type='24 Hrs Sale')
 * - BLA_ABC_PAID_PCT: Paid / Total Sales (payment_status='Paid' AND
 *   business_type='Real Time Sales', per the SOP's own COD/PAID split)
 *
 * Run with: npx tsx scripts/add-bla-bli-blu-abc-sales-kpis.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const PROCESS_NAME = "Bla Bli Blu";
const SOURCE_TABLE = "bla_bli_blu_overall_sales_raw";

interface Ref extends RowDataPacket { id: string }

async function main() {
  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = ? AND active_status = 1 LIMIT 1",
    [PROCESS_NAME],
  );
  const processId = procRows[0]?.id;
  if (!processId) throw new Error(`No active process found named "${PROCESS_NAME}"`);
  console.log(`Process: ${PROCESS_NAME} (${processId})`);

  // 1. Data source
  const sourceId = randomUUID();
  await db.execute(
    `INSERT INTO kpi_studio_data_source
       (id, source_code, source_name, source_type, integration_key, source_object,
        employee_key_column, employee_key_kind, date_column, date_format, config_json,
        description, active_status, created_by, process_key_kind, process_key_column,
        process_key_value, process_id)
     VALUES (?, 'BLA_ABC_OVERALL_SALES', 'Bla Bli Blu Abandoned Cart Sales (Overall Sales Raw)',
             'local_query', NULL, ?, 'emp_code', 'employee_code', 'report_date', NULL, NULL,
             'Real-Time/Same-Day-PTP/24-Hour-PTP sales for Cart ABC, already classified in business_type per the real Sales Mapping SOP -- this source only adds the missing KPI layer on top of already-live data.',
             1, 'demo-super-admin-id', 'employee', NULL, NULL, ?)`,
    [sourceId, SOURCE_TABLE, processId],
  );
  console.log(`Created data source BLA_ABC_OVERALL_SALES (${sourceId})`);

  // 2. Source fields (aggregations the definitions below will reference)
  const fields: Array<{ field_name: string; display_name: string; source_column: string; aggregate_fn: string; filter_json: unknown; unit: string }> = [
    { field_name: "real_time_sales_count", display_name: "Real-Time Sales Count", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ op: "eq", value: "Real Time Sales", column: "business_type" }], unit: "count" },
    { field_name: "real_time_revenue", display_name: "Real-Time Sales Revenue", source_column: "amount", aggregate_fn: "SUM",
      filter_json: [{ op: "eq", value: "Real Time Sales", column: "business_type" }], unit: "currency" },
    { field_name: "same_day_ptp_count", display_name: "Same Day PTP Count", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ op: "eq", value: "Same Day PTP", column: "business_type" }], unit: "count" },
    { field_name: "ptp_24hr_count", display_name: "24-Hour PTP Count", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ op: "eq", value: "24 Hrs Sale", column: "business_type" }], unit: "count" },
    { field_name: "paid_real_time_count", display_name: "Paid Real-Time Sales Count", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ op: "eq", value: "Real Time Sales", column: "business_type" }, { op: "eq", value: "Paid", column: "payment_status" }], unit: "count" },
  ];
  const fieldIds: Record<string, string> = {};
  for (const f of fields) {
    const id = randomUUID();
    fieldIds[f.field_name] = id;
    await db.execute(
      `INSERT INTO kpi_studio_source_field
         (id, data_source_id, field_name, display_name, source_column, aggregate_fn,
          source_expression, filter_json, unit, description, active_status)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 1)`,
      [id, sourceId, f.field_name, f.display_name, f.source_column, f.aggregate_fn, JSON.stringify(f.filter_json), f.unit],
    );
    console.log(`  field ${f.field_name} -> ${id}`);
  }

  // 3. Metrics (kpi_metric_master) + definitions (kpi_studio_definition)
  const metrics: Array<{ code: string; name: string; unit: string; direction: string; formula: string }> = [
    { code: "BLA_ABC_SALES_COUNT", name: "Bla Bli Blu Cart ABC Real-Time Sales", unit: "count", direction: "higher_is_better", formula: "real_time_sales_count" },
    { code: "BLA_ABC_REVENUE", name: "Bla Bli Blu Cart ABC Revenue", unit: "currency", direction: "higher_is_better", formula: "real_time_revenue" },
    { code: "BLA_ABC_AOV", name: "Bla Bli Blu Cart ABC Average Order Value", unit: "currency", direction: "higher_is_better", formula: "SAFE_DIV(real_time_revenue, real_time_sales_count)" },
    { code: "BLA_ABC_PTP_SAMEDAY_COUNT", name: "Bla Bli Blu Cart ABC Same Day PTP Sales", unit: "count", direction: "higher_is_better", formula: "same_day_ptp_count" },
    { code: "BLA_ABC_PTP_24HR_COUNT", name: "Bla Bli Blu Cart ABC 24-Hour PTP Sales", unit: "count", direction: "higher_is_better", formula: "ptp_24hr_count" },
    { code: "BLA_ABC_PAID_PCT", name: "Bla Bli Blu Cart ABC Paid Contribution %", unit: "percent", direction: "higher_is_better", formula: "PCT(paid_real_time_count, real_time_sales_count)" },
  ];

  // family/category follow the exact precedent already set by BELLA_REPEAT_SALES_COUNT /
  // BELLA_REPEAT_REVENUE / HOUSING_PREMIUM_SALES_COUNT (checked live): 'custom'/'custom',
  // scoring_type NULL -- not 'sales', which is a valid enum value but not what any real
  // sibling sales-count/revenue metric actually uses.
  for (const m of metrics) {
    const metricId = randomUUID();
    await db.execute(
      `INSERT INTO kpi_metric_master
         (id, metric_code, metric_name, family, category, unit, direction, scoring_type,
          aggregation_method, decimal_places, active_status)
       VALUES (?, ?, ?, 'custom', 'custom', ?, ?, NULL, 'sum', 2, 1)`,
      [metricId, m.code, m.name, m.unit, m.direction],
    );
    const defId = randomUUID();
    await db.execute(
      `INSERT INTO kpi_studio_definition
         (id, metric_id, grain, process_id, data_source_id, formula_expression,
          aggregation_method, scoring_type, effective_from, active_status, created_by)
       VALUES (?, ?, 'process', ?, ?, ?, 'sum', 'raw', CURDATE(), 1, 'demo-super-admin-id')`,
      [defId, metricId, processId, sourceId, m.formula],
    );
    console.log(`Created metric ${m.code} (${metricId}) + definition (${defId})`);
  }

  console.log("\nDone. 1 data source, 5 fields, 6 metrics + definitions created.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED", e); process.exit(1); });
