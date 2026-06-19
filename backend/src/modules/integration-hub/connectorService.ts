import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { db } from "../../db/mysql.js";
import { integrationService } from "./integration.service.js";
import { analyzeSchema } from "./schemaAnalyzer.js";
import { promoteRows } from "./promotionEngine.js";
import { encryptSecretPayload } from "../external-db/external-db.service.js";

export interface ConnectorRunSummary {
  run_id: string;
  rows_fetched: number;
  rows_promoted: number;
  rows_failed: number;
  status: "complete" | "failed";
}

export async function runConnector(
  integrationKey: string,
  rawRows: Record<string, unknown>[],
  userId: string | null,
  triggeredBy = "manual",
): Promise<ConnectorRunSummary> {
  const run = await integrationService.createRun(integrationKey, triggeredBy, userId);
  const runId = run.id;
  const startedAt = Date.now();

  try {
    // 1. Store raw payload
    const payloadJson = JSON.stringify(rawRows);
    const encryptedPayload = encryptSecretPayload({ rows: rawRows });
    const hash = createHash("sha256").update(payloadJson).digest("hex");
    await db.execute(
      `INSERT INTO integration_raw_payload (id, run_id, integration_key, payload, payload_hash, row_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), runId, integrationKey, encryptedPayload, hash, rawRows.length]
    );

    // 2. Analyze schema
    const detectedFields = analyzeSchema(rawRows);
    await db.execute(
      `INSERT INTO integration_schema_snapshot (id, integration_key, run_id, detected_fields)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), integrationKey, runId, JSON.stringify(detectedFields)]
    );

    // 3. Get confirmed field maps
    const fieldMaps = await integrationService.listFieldMaps(integrationKey);
    const mappedFieldNames = new Set(fieldMaps.map((m) => m.source_field));

    // 4. Generate suggestions for unmapped detected fields
    const unmapped = detectedFields.filter((f) => !mappedFieldNames.has(f.name));
    for (const field of unmapped) {
      await db.execute(
        `INSERT IGNORE INTO integration_field_map_suggestion
           (id, integration_key, source_field, status)
         VALUES (?, ?, ?, 'pending')`,
        [randomUUID(), integrationKey, field.name]
      );
    }

    // 5. Promote rows using confirmed maps
    const { promoted, failed } = await promoteRows(integrationKey, rawRows, fieldMaps, runId);

    // 6. Mark run complete
    const durationMs = Date.now() - startedAt;
    await db.execute(
      `UPDATE integration_connector_run
          SET status = 'complete', rows_fetched = ?, rows_promoted = ?, rows_failed = ?,
              duration_ms = ?, completed_at = NOW()
        WHERE id = ?`,
      [rawRows.length, promoted, failed, durationMs, runId]
    );

    return { run_id: runId, rows_fetched: rawRows.length, rows_promoted: promoted, rows_failed: failed, status: "complete" };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    await db.execute(
      `UPDATE integration_connector_run
          SET status = 'failed', duration_ms = ?, error_message = ?, completed_at = NOW()
        WHERE id = ?`,
      [durationMs, msg, runId]
    );
    return { run_id: runId, rows_fetched: rawRows.length, rows_promoted: 0, rows_failed: rawRows.length, status: "failed" };
  }
}
