import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";
import type { RowDataPacket } from "mysql2";

/**
 * Queue identifiers that could not be mapped, instead of dropping them.
 *
 * kpi-data-connector's writeFacts() increments a `skipped` counter and moves on
 * when an agent code matches no employee. Nothing records WHICH code, so an
 * agent whose identifier drifts simply stops being measured and no one finds
 * out — the sync still reports success, just with a smaller number in it.
 *
 * integration_mapping_exception already exists for exactly this, with a
 * resolution workflow behind it, and has 0 rows. This gives it its first writer.
 *
 * The table's UNIQUE key is (source_system, source_entity, external_identifier,
 * exception_type, integration_run_id). With integration_run_id NULL — which is
 * the case here, since these come from a scheduled metric sync rather than an
 * Integration Hub run — MySQL treats NULL <> NULL, so a plain INSERT would add a
 * duplicate row on every sync. That is why this looks for an open row first.
 */

export type MappingExceptionType =
  | "employee_unmapped"
  | "process_unmapped"
  | "branch_unmapped"
  | "metric_unmapped"
  | "invalid_value";

export type MappingExceptionInput = {
  sourceSystem: string;
  sourceEntity: string;
  externalIdentifier: string;
  exceptionType: MappingExceptionType;
  detail?: string;
};

/**
 * Record one unmapped identifier, or leave the existing open row alone.
 *
 * Swallows its own errors by design: failing to log an exception must never be
 * the reason a metric sync fails. A sync that dies because it could not record
 * a warning is strictly worse than one that missed a row.
 */
export async function recordMappingException(input: MappingExceptionInput): Promise<void> {
  const identifier = String(input.externalIdentifier ?? "").trim();
  if (!identifier) return;

  try {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM integration_mapping_exception
        WHERE source_system = ? AND source_entity = ? AND external_identifier = ?
          AND exception_type = ? AND status = 'open'
        LIMIT 1`,
      [input.sourceSystem, input.sourceEntity, identifier, input.exceptionType],
    );

    if (existing.length > 0) {
      // Already queued and unresolved. Refresh the timestamp so the age of the
      // row reflects "still happening" rather than "first seen months ago".
      await db.execute(
        `UPDATE integration_mapping_exception SET updated_at = NOW(), exception_detail = ? WHERE id = ?`,
        [input.detail ?? null, existing[0].id],
      );
      return;
    }

    await db.execute(
      `INSERT INTO integration_mapping_exception
         (id, source_system, source_entity, external_identifier, exception_type,
          exception_detail, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', NOW(), NOW())`,
      [randomUUID(), input.sourceSystem, input.sourceEntity, identifier, input.exceptionType, input.detail ?? null],
    );
  } catch (err) {
    logger.warn(
      { err, ...input },
      "[MappingException] could not queue an unmapped identifier — the sync continues",
    );
  }
}

/** Count of open exceptions, for surfacing on an admin screen or a health check. */
export async function countOpenMappingExceptions(sourceSystem?: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    sourceSystem
      ? `SELECT COUNT(*) AS n FROM integration_mapping_exception WHERE status = 'open' AND source_system = ?`
      : `SELECT COUNT(*) AS n FROM integration_mapping_exception WHERE status = 'open'`,
    sourceSystem ? [sourceSystem] : [],
  );
  return Number(rows[0]?.n ?? 0);
}
