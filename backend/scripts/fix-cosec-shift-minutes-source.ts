/**
 * Real bug, live-verified 2026-09-10: KPI Studio's two cosec biometric data
 * sources (COSEC_DAILY_ONFIDO, COSEC_SHARED) point at `cosec_daily_agg`,
 * which froze on 2026-06-17 (same date `cosec_punch_sync` froze -- see
 * hrms2-cosec-worker-single-registration memory). The live biometric feed
 * migrated to `integration_biometric_daily` (confirmed fresh through
 * yesterday, syncing every ~5 minutes) but nobody repointed the KPI Studio
 * sources, so SHIFT_MINUTES_AVG (~34 processes) and SELF_ATTENDANCE_BOOLEAN
 * (Onfido) have silently read a dead table for ~85 days.
 *
 * This creates two new data sources pointed at integration_biometric_daily
 * (employee_code/activity_date/biometric_minutes in place of
 * user_id/shift_date/work_minutes -- confirmed 100% employee_code join rate
 * for September), replicates the existing field mappings, and repoints every
 * active kpi_studio_definition row from the old sources to the new ones.
 * The old (dead) sources and their fields are left in place, not deleted,
 * per this project's "never delete solely to simplify" rule -- they become
 * orphaned but harmless, and the audit trail of what changed stays intact.
 *
 * Run with: npx tsx scripts/fix-cosec-shift-minutes-source.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const OLD_SOURCES = [
  { id: "9a60aedc-ab2d-11f1-8f5c-00155d0ab410", code: "COSEC_DAILY_ONFIDO" },
  { id: "dfd07eb5-ab42-11f1-8f5c-00155d0ab410", code: "COSEC_SHARED" },
] as const;

async function main() {
  const [oldSources] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM kpi_studio_data_source WHERE id IN (?, ?)`,
    [OLD_SOURCES[0].id, OLD_SOURCES[1].id],
  );
  if (oldSources.length !== 2) throw new Error(`Expected 2 old sources, found ${oldSources.length}`);

  const idMap = new Map<string, string>(); // old id -> new id

  for (const old of oldSources) {
    const newId = randomUUID();
    idMap.set(old.id as string, newId);
    const newCode = (old.source_code as string).replace("COSEC_DAILY_ONFIDO", "BIOMETRIC_DAILY_ONFIDO").replace("COSEC_SHARED", "BIOMETRIC_DAILY_SHARED");
    await db.execute(
      `INSERT INTO kpi_studio_data_source
         (id, source_code, source_name, source_type, integration_key, source_object,
          employee_key_column, employee_key_kind, date_column, date_format, config_json,
          description, active_status, created_by, process_key_kind, process_key_column,
          process_key_value, process_id)
       VALUES (?, ?, ?, ?, ?, 'integration_biometric_daily',
               'employee_code', 'employee_code', 'activity_date', NULL, NULL,
               ?, 1, ?, ?, ?, ?, ?)`,
      [
        newId, newCode,
        (old.source_name as string) + " (live, integration_biometric_daily)",
        old.source_type, old.integration_key,
        (old.description as string) + " -- repoints the dead cosec_daily_agg (frozen 2026-06-17) to the live integration_biometric_daily feed.",
        old.created_by, old.process_key_kind, old.process_key_column, old.process_key_value, old.process_id,
      ],
    );
    console.log(`Created ${newCode} (${newId}) from ${old.source_code}`);

    const [fields] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM kpi_studio_source_field WHERE data_source_id = ?`,
      [old.id],
    );
    for (const f of fields) {
      // mysql2 auto-parses JSON columns into JS values already -- do not JSON.parse again.
      const parsedFilter = typeof f.filter_json === "string" ? JSON.parse(f.filter_json) : f.filter_json;
      const newFilterJson = parsedFilter
        ? JSON.stringify((parsedFilter as Array<{ column: string }>).map((c) => ({ ...c, column: "biometric_minutes" })))
        : null;
      const newExpr = f.source_expression ? (f.source_expression as string).replace(/work_minutes/g, "biometric_minutes") : null;
      await db.execute(
        `INSERT INTO kpi_studio_source_field
           (id, data_source_id, field_name, display_name, source_column, aggregate_fn,
            source_expression, filter_json, unit, description, active_status)
         VALUES (?, ?, ?, ?, 'biometric_minutes', ?, ?, ?, ?, ?, 1)`,
        [randomUUID(), newId, f.field_name, f.display_name, f.aggregate_fn, newExpr, newFilterJson, f.unit, f.description],
      );
    }
    console.log(`  -> replicated ${fields.length} field mapping(s)`);
  }

  let totalRepointed = 0;
  for (const old of OLD_SOURCES) {
    const newId = idMap.get(old.id)!;
    const [result] = await db.execute(
      `UPDATE kpi_studio_definition SET data_source_id = ? WHERE data_source_id = ? AND active_status = 1`,
      [newId, old.id],
    );
    const affected = (result as { affectedRows: number }).affectedRows;
    totalRepointed += affected;
    console.log(`Repointed ${affected} active definition(s) from ${old.code} to its live equivalent`);
  }

  console.log(`\nTotal definitions repointed: ${totalRepointed}`);
  console.log("Old (dead) sources and fields left in place, deactivated nothing, deleted nothing.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED", e); process.exit(1); });
