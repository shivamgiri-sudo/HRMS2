/**
 * Privacy Retention Worker
 *
 * Runs daily (wired from server.ts under ENABLE_SCHEDULERS).
 * Default mode: dry_run — identifies candidates, writes to privacy_retention_candidate,
 * generates a run report, but does NOT delete or anonymize anything.
 *
 * To execute actions the DPO must:
 *   1. Review the dry-run candidate list for a given run_id
 *   2. Create a record in privacy_retention_approval for that run_id
 *   3. Re-trigger with PRIVACY_RETENTION_MODE=approved_actions
 *
 * A disposal certificate is written for every executed run.
 */

import crypto from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

const MODE = (process.env.PRIVACY_RETENTION_MODE ?? "dry_run") as "dry_run" | "approved_actions";

interface RetentionPolicy {
  id: string;
  entity_type: string;
  retention_days: number;
  action_on_expiry: "anonymize" | "delete" | "archive" | "notify_admin";
  is_active: number;
}

interface RetentionCandidate {
  entity_id: string;
  record_date: Date | null;
  has_hold: boolean;
}

// Maps entity_type → query that returns { entity_id, record_date }
// All queries must reference the entity's lifecycle end date, falling back to created_at.
const ENTITY_QUERIES: Record<string, string> = {
  ats_candidate: `
    SELECT id AS entity_id, COALESCE(updated_at, created_at) AS record_date
    FROM ats_candidate
    WHERE active_status = 0
      AND DATEDIFF(NOW(), COALESCE(updated_at, created_at)) > ?
    LIMIT 500
  `,
  employees: `
    SELECT id AS entity_id, COALESCE(exit_date, updated_at) AS record_date
    FROM employees
    WHERE employment_status IN ('resigned','terminated','absconding')
      AND DATEDIFF(NOW(), COALESCE(exit_date, updated_at)) > ?
    LIMIT 500
  `,
  data_consent: `
    SELECT id AS entity_id, withdrawn_at AS record_date
    FROM data_consent
    WHERE withdrawn_at IS NOT NULL
      AND DATEDIFF(NOW(), withdrawn_at) > ?
    LIMIT 500
  `,
  data_rights_request: `
    SELECT id AS entity_id, resolved_at AS record_date
    FROM data_rights_request
    WHERE status IN ('resolved','rejected')
      AND resolved_at IS NOT NULL
      AND DATEDIFF(NOW(), resolved_at) > ?
    LIMIT 500
  `,
};

// Anonymize handlers — minimal: NULL out PII fields
const ANONYMIZE_HANDLERS: Record<string, (entityId: string) => Promise<void>> = {
  ats_candidate: async (id) => {
    await db.execute(
      `UPDATE ats_candidate
       SET full_name = 'ANONYMIZED', mobile = NULL, email = NULL,
           address = NULL, pan_number = NULL, pan_number_masked = NULL,
           aadhar_number_masked = NULL, bank_account_no_masked = NULL,
           aadhar_number_hash = NULL, pan_number_hash = NULL, bank_account_no_hash = NULL,
           date_of_birth = NULL, updated_at = NOW()
       WHERE id = ?`,
      [id]
    );
  },
};

async function hasActiveHold(entityType: string, entityId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM dpdp_processing_hold
     WHERE entity_type = ? AND entity_id = ? AND is_active = 1 LIMIT 1`,
    [entityType, entityId]
  );
  return rows.length > 0;
}

async function hasApproval(runId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM privacy_retention_approval WHERE run_id = ? LIMIT 1`,
    [runId]
  );
  return rows.length > 0;
}

export async function runRetentionWorker(): Promise<void> {
  const runId = crypto.randomUUID();
  const runMode = MODE;

  await db.execute(
    `INSERT INTO privacy_retention_run (id, run_mode, status, triggered_by)
     VALUES (?, ?, 'started', 'cron')`,
    [runId, runMode]
  );

  process.stdout.write(
    JSON.stringify({ level: "info", module: "privacy-retention", event: "RETENTION_RUN_STARTED", runId, runMode }) + "\n"
  );

  try {
    // Load active retention policies
    const [policies] = await db.execute<RowDataPacket[]>(
      `SELECT id, entity_type, retention_days, action_on_expiry
       FROM data_retention_policy WHERE is_active = 1`
    );

    let candidateCount = 0;
    let actionedCount = 0;

    for (const policy of policies as RetentionPolicy[]) {
      const queryTemplate = ENTITY_QUERIES[policy.entity_type];
      if (!queryTemplate) continue; // No handler defined yet — skip silently

      const [entityRows] = await db.execute<RowDataPacket[]>(queryTemplate, [policy.retention_days]);

      for (const row of entityRows) {
        const entityId: string = row.entity_id;
        const recordDate: Date | null = row.record_date ?? null;
        const holdActive = await hasActiveHold(policy.entity_type, entityId).catch(() => true); // fail safe

        const eligible = !holdActive;
        candidateCount++;

        await db.execute(
          `INSERT INTO privacy_retention_candidate
             (id, run_id, policy_id, entity_type, entity_id, table_name,
              record_date, retention_days, disposal_action,
              has_legal_hold, has_processing_hold, eligible_for_action)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            runId,
            policy.id,
            policy.entity_type,
            entityId,
            policy.entity_type, // table_name ≈ entity_type here
            recordDate,
            policy.retention_days,
            policy.action_on_expiry === "notify_admin" ? "anonymize" : policy.action_on_expiry,
            holdActive ? 1 : 0,
            eligible ? 1 : 0,
          ]
        );

        // Execute actions only in approved_actions mode with a valid approval record
        if (runMode === "approved_actions" && eligible) {
          const approved = await hasApproval(runId);
          if (!approved) continue;

          const handler = ANONYMIZE_HANDLERS[policy.entity_type];
          if (handler) {
            try {
              await handler(entityId);
              await db.execute(
                `UPDATE privacy_retention_candidate
                 SET actioned_at = NOW(), action_result = 'anonymized'
                 WHERE run_id = ? AND entity_id = ?`,
                [runId, entityId]
              );
              actionedCount++;
            } catch (err) {
              await db.execute(
                `UPDATE privacy_retention_candidate
                 SET action_result = 'error', error_details = ?
                 WHERE run_id = ? AND entity_id = ?`,
                [err instanceof Error ? err.message : String(err), runId, entityId]
              );
            }
          }
        }
      }
    }

    // Write disposal certificate if actions were taken
    if (actionedCount > 0) {
      const manifest = JSON.stringify({ runId, actionedCount, generatedAt: new Date().toISOString() });
      const certHash = crypto.createHash("sha256").update(manifest).digest("hex");
      await db.execute(
        `INSERT INTO privacy_disposal_certificate
           (id, run_id, entity_type, records_count, disposal_type, certificate_hash)
         VALUES (UUID(), ?, 'multiple', ?, 'anonymize', ?)`,
        [runId, actionedCount, certHash]
      );
    }

    await db.execute(
      `UPDATE privacy_retention_run
       SET status = 'completed', completed_at = NOW(),
           candidate_count = ?, actioned_count = ?
       WHERE id = ?`,
      [candidateCount, actionedCount, runId]
    );

    process.stdout.write(
      JSON.stringify({
        level: "info", module: "privacy-retention", event: "RETENTION_RUN_COMPLETED",
        runId, runMode, candidateCount, actionedCount,
      }) + "\n"
    );
  } catch (err) {
    await db.execute(
      `UPDATE privacy_retention_run
       SET status = 'failed', completed_at = NOW(),
           error_summary = ?
       WHERE id = ?`,
      [err instanceof Error ? err.message : String(err), runId]
    ).catch(() => {});

    process.stderr.write(
      JSON.stringify({
        level: "error", module: "privacy-retention", event: "RETENTION_RUN_FAILED",
        runId, error: err instanceof Error ? err.message : String(err),
      }) + "\n"
    );
  }
}

export function startRetentionCron(): void {
  // Run once at startup (delayed 30s to let DB settle), then every 24 hours
  setTimeout(() => {
    runRetentionWorker().catch((err) =>
      process.stderr.write(
        JSON.stringify({ level: "error", module: "privacy-retention", event: "CRON_START_FAILED", error: String(err) }) + "\n"
      )
    );
  }, 30_000);

  setInterval(
    () => {
      runRetentionWorker().catch((err) =>
        process.stderr.write(
          JSON.stringify({ level: "error", module: "privacy-retention", event: "CRON_TICK_FAILED", error: String(err) }) + "\n"
        )
      );
    },
    24 * 60 * 60 * 1000
  );
}
