/**
 * KPI Studio wiring for the newly-built reginald_abandoned_cart_sales_raw
 * (sql/1752, 10,738 real rows just imported). Mirrors the exact pattern
 * fixed for BLA_ABC_OVERALL_SALES: process_key_kind='constant' (pinning
 * to the Reginald process directly), since employee-based resolution
 * failed there when the real agents' employees.process_id didn't match.
 *
 * Metrics: sales count and revenue for ABCD (Abandoned Cart) and REPT
 * (Repeat) separately, matching the sheet's own only 2 real LOB values.
 *
 * Run with: npx tsx scripts/add-reginald-abandoned-cart-sales-kpis.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface Ref extends RowDataPacket { id: string }

async function main() {
  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Reginald' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id;
  if (!processId) throw new Error('No active process found named "Reginald"');
  console.log(`Process: Reginald (${processId})`);

  const sourceId = randomUUID();
  await db.execute(
    `INSERT INTO kpi_studio_data_source
       (id, source_code, source_name, source_type, integration_key, source_object,
        employee_key_column, employee_key_kind, date_column, date_format, config_json,
        description, active_status, created_by, process_key_kind, process_key_column,
        process_key_value, process_id)
     VALUES (?, 'REGINALD_ABC_SALES', 'Reginald Men Abandoned Cart -- Live Sales (Google Form)',
             'local_query', NULL, 'reginald_abandoned_cart_sales_raw', 'emp_id', 'employee_code',
             'order_date', NULL, NULL,
             'Real Live Sales Google Form data, LOB=ABCD (Abandoned Cart) / REPT (Repeat), the only 2 real values.',
             1, 'demo-super-admin-id', 'constant', NULL, NULL, ?)`,
    [sourceId, processId],
  );
  console.log(`Created data source REGINALD_ABC_SALES (${sourceId})`);

  const fields: Array<{ name: string; display: string; column: string; fn: string; lob: string }> = [
    { name: "abcd_sales_count", display: "Abandoned Cart Sales Count", column: "id", fn: "COUNT", lob: "ABCD" },
    { name: "abcd_revenue", display: "Abandoned Cart Revenue", column: "amount", fn: "SUM", lob: "ABCD" },
    { name: "rept_sales_count", display: "Repeat Sales Count", column: "id", fn: "COUNT", lob: "REPT" },
    { name: "rept_revenue", display: "Repeat Revenue", column: "amount", fn: "SUM", lob: "REPT" },
  ];
  for (const f of fields) {
    await db.execute(
      `INSERT INTO kpi_studio_source_field
         (id, data_source_id, field_name, display_name, source_column, aggregate_fn,
          source_expression, filter_json, unit, description, active_status)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 1)`,
      [randomUUID(), sourceId, f.name, f.display, f.column, f.fn,
        JSON.stringify([{ op: "eq", value: f.lob, column: "lob" }]),
        f.fn === "SUM" ? "currency" : "count"],
    );
    console.log(`  field ${f.name} created`);
  }

  const metrics: Array<{ code: string; name: string; unit: string; formula: string }> = [
    { code: "REGINALD_ABCD_SALES_COUNT", name: "Reginald Abandoned Cart Sales Count", unit: "count", formula: "abcd_sales_count" },
    { code: "REGINALD_ABCD_REVENUE", name: "Reginald Abandoned Cart Revenue", unit: "currency", formula: "abcd_revenue" },
    { code: "REGINALD_ABCD_AOV", name: "Reginald Abandoned Cart Average Order Value", unit: "currency", formula: "SAFE_DIV(abcd_revenue, abcd_sales_count)" },
    { code: "REGINALD_REPT_SALES_COUNT", name: "Reginald Repeat Sales Count", unit: "count", formula: "rept_sales_count" },
    { code: "REGINALD_REPT_REVENUE", name: "Reginald Repeat Revenue", unit: "currency", formula: "rept_revenue" },
  ];
  for (const m of metrics) {
    const metricId = randomUUID();
    await db.execute(
      `INSERT INTO kpi_metric_master
         (id, metric_code, metric_name, family, category, unit, direction, scoring_type,
          aggregation_method, decimal_places, active_status)
       VALUES (?, ?, ?, 'custom', 'custom', ?, 'higher_is_better', NULL, 'sum', 2, 1)`,
      [metricId, m.code, m.name, m.unit],
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

  console.log("\nDone. 1 data source, 4 fields, 5 metrics + definitions created.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED", e); process.exit(1); });
