/**
 * HRMS_ATTENDANCE_DAILY was stale (untouched since 2026-09-07, confirmed via
 * updated_at before touching it -- not live WIP) and had two real problems,
 * found by the unused-fields/orphaned-sources scan:
 *
 * 1. Its one field, late_marks, was `COUNT(late_by_minutes)` with no filter.
 *    attendance_daily_record.late_by_minutes is 0 (not NULL) for on-time
 *    records -- confirmed live, 0 NULLs across 19,889+ rows in the last month
 *    -- so COUNT() counted every attendance row, not just late ones. Fixed to
 *    COUNT rows where late_by_minutes > 0.
 * 2. process_key_kind was 'none', which cannot back a process-grain metric at
 *    all (buildProcessQueryPlan refuses it outright) -- yet employee_key_column
 *    ('employee_id') and employee_key_kind ('employee_id') were already
 *    correctly configured for the 'employee' join. Flipped to 'employee',
 *    matching the working ATTENDANCE_RECON/ATTENDANCE_REGUL pattern: one
 *    shared source, one definition per process (the process is looked up
 *    from the employee, so no per-process source rows are needed).
 *
 * Run with: npx tsx scripts/fix-and-wire-hrms-attendance-daily-late-marks.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveDataSource, saveSourceField, saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

const SOURCE_ID = "aba5c6ef-a783-11f1-8f5c-00155d0ab410";
const CREATED_BY = "demo-super-admin-id";

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`, [code]);
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction } as never);
  return String((created as { id: string }).id);
}

async function main() {
  // saveDataSource requires SOME process_id even for the 'employee' kind
  // (validated at save time) -- it is just an anchor and is not actually used
  // at compute time, which instead reads processIdOverride from whichever
  // DEFINITION is asking (see buildProcessQueryPlan's own comment on this).
  // ATTENDANCE_RECON/ATTENDANCE_REGUL both anchor on Onfido for the same
  // reason; matched here for consistency.
  const ANCHOR_PROCESS_ID = "04f20ddc-67ba-11f1-adb1-00155d0ab410"; // Onfido

  // 1. Fix process_key_kind so this source can back a process-grain metric.
  await saveDataSource({
    id: SOURCE_ID,
    source_code: "HRMS_ATTENDANCE_DAILY",
    source_name: "Attendance (this system)",
    source_type: "local_query",
    source_object: "attendance_daily_record",
    date_column: "record_date",
    employee_key_column: "employee_id",
    employee_key_kind: "employee_id",
    description: "Daily attendance rows already in this system.",
    process_key_kind: "employee",
    process_id: ANCHOR_PROCESS_ID,
  } as never, CREATED_BY);
  console.log("[FIX] process_key_kind: none -> employee");

  // 2. Fix the late_marks field's filter.
  const [fieldRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM kpi_studio_source_field WHERE data_source_id = ? AND field_name = 'late_marks'`, [SOURCE_ID],
  );
  await saveSourceField({
    id: fieldRows[0] ? String(fieldRows[0].id) : undefined,
    data_source_id: SOURCE_ID, field_name: "late_marks", source_column: "late_by_minutes", aggregate_fn: "COUNT",
    filter_json: [{ column: "late_by_minutes", op: "gt", value: 0 }],
  } as never);
  console.log("[FIX] late_marks: COUNT(late_by_minutes) -> COUNT WHERE late_by_minutes > 0");

  // 3. Wire LATE_MARKS_COUNT for every active process (same pattern as
  //    ATTENDANCE_RECON/ATTENDANCE_REGUL -- one definition per process,
  //    same shared source).
  const metricId = await ensureMetric("LATE_MARKS_COUNT", "Late marks", "count", "lower_is_better");
  const [processes] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE active_status = 1`);
  let wired = 0;
  for (const proc of processes as any[]) {
    await saveDefinition({
      metric_id: metricId, grain: "process", process_id: String(proc.id),
      data_source_id: SOURCE_ID, formula_expression: "late_marks",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    wired++;
    if (wired % 20 === 0) console.log(`[FIX] ${wired}/${(processes as any[]).length} processes wired`);
  }
  console.log(`[FIX] Done. LATE_MARKS_COUNT wired for ${wired} processes.`);
  process.exit(0);
}
main().catch((e) => { console.error("[FIX] FAILED", e); process.exit(1); });
