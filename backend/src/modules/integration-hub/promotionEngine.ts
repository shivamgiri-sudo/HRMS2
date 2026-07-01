import { db } from "../../db/mysql.js";
import type { IntegrationFieldMap } from "./integration.types.js";

export interface PromotionResult {
  promoted: number;
  failed: number;
}

/** Validate MySQL identifier (table/column names) to prevent SQL injection */
function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

const INTEGRATION_TARGET_TABLES = new Set([
  "dialer_session_log",
]);

export async function promoteRows(
  integrationKey: string,
  rows: Record<string, unknown>[],
  fieldMaps: IntegrationFieldMap[],
  runId: string
): Promise<PromotionResult> {
  if (rows.length === 0) return { promoted: 0, failed: 0 };

  // Group maps by target table
  const byTable = new Map<string, IntegrationFieldMap[]>();
  for (const map of fieldMaps) {
    if (!isValidIdentifier(map.target_table) || !isValidIdentifier(map.target_column) || !isValidIdentifier(map.source_field)) {
      continue; // Skip invalid identifiers instead of failing entire batch
    }
    if (!INTEGRATION_TARGET_TABLES.has(map.target_table)) continue;
    if (!byTable.has(map.target_table)) byTable.set(map.target_table, []);
    byTable.get(map.target_table)!.push(map);
  }

  let promoted = 0;
  let failed = 0;

  for (const row of rows) {
    for (const [targetTable, maps] of byTable) {
      // Only map source fields that exist in this row
      const applicableMaps = maps.filter((m) => m.source_field in row);
      if (applicableMaps.length === 0) continue;

      const columns = applicableMaps.map((m) => m.target_column);
      const values = applicableMaps.map((m) => row[m.source_field] ?? null);
      const placeholders = columns.map(() => "?").join(", ");

      const sql = `INSERT INTO ${targetTable} (integration_key, run_id, ${columns.join(", ")}) VALUES (?, ?, ${placeholders})`;

      try {
        await db.execute(sql, [integrationKey, runId, ...values]);
        promoted++;
      } catch {
        failed++;
      }
    }
  }

  return { promoted, failed };
}
