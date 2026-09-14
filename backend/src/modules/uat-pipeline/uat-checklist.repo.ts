/**
 * Persistence for the checklist engine.
 *
 * Split from uat-checklist.service.ts on purpose: the merge logic is the security-relevant
 * part and is pure, so it can be tested exhaustively without a database. Everything that
 * touches MySQL lives here.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { sha256 } from "./control-plane.js";
import type { ChecklistItemResult, DbChecklistRule } from "./uat-checklist.service.js";
import type { CapabilityHit, StaticScanResult } from "./uat-pipeline.types.js";

type UatConnection = PoolConnection | Awaited<ReturnType<typeof db.getConnection>>;

interface RuleRow extends RowDataPacket {
  item_key: string;
  failure_mode: "block" | "warn";
  is_floor: number;
  rule_version: number;
  evaluator: "static" | "llm" | "human" | "hybrid";
  statement: string;
  evidence_spec: string;
  category: string;
}

export interface LoadedChecklist {
  rules: DbChecklistRule[];
  /** Items whose failure blocks. Used by gateFor(); floor items are always blocking. */
  blockingItemKeys: Set<string>;
  /** Hash of the active rule set as it was read, stored on every evaluation row. */
  snapshotSha: string;
  /** Statement text, for rendering the console without a second query. */
  statements: Map<string, { statement: string; category: string; evidenceSpec: string }>;
}

/**
 * Read the active checklist.
 *
 * Fails closed: if the table is empty — never migrated, or emptied by an admin — this throws
 * rather than returning zero rules, because zero rules is indistinguishable from "everything
 * passed" at every layer above.
 */
export async function loadChecklist(conn?: UatConnection): Promise<LoadedChecklist> {
  const runner = conn ?? db;
  const [rows] = await runner.query<RuleRow[]>(
    `SELECT item_key, failure_mode, is_floor, rule_version, evaluator,
            statement, evidence_spec, category
       FROM uat_checklist_item
      WHERE active_status = 1
      ORDER BY sort_order, item_key`
  );

  if (!rows.length) {
    throw new Error(
      "[uat] uat_checklist_item has no active rows; refusing to evaluate a checklist that " +
        "would vacuously pass."
    );
  }

  const rules: DbChecklistRule[] = rows.map((r) => ({
    itemKey: r.item_key,
    failureMode: r.failure_mode,
    isFloor: r.is_floor === 1,
    ruleVersion: r.rule_version,
    evaluator: r.evaluator,
  }));

  const blockingItemKeys = new Set(
    rows.filter((r) => r.failure_mode === "block").map((r) => r.item_key)
  );
  // Floor items always block, whatever the mirror row happens to say. The mirror is for
  // display; letting it downgrade a floor item to a warn would be the loosening path this
  // whole design exists to close.
  for (const r of rows) if (r.is_floor === 1) blockingItemKeys.add(r.item_key);

  const statements = new Map(
    rows.map((r) => [
      r.item_key,
      { statement: r.statement, category: r.category, evidenceSpec: r.evidence_spec },
    ])
  );

  // Hashes the rules as they were read — the version, the mode and the floor flag — so a
  // later edit is detectable from the evaluation row alone.
  const snapshotSha = sha256(
    JSON.stringify(
      rows.map((r) => [r.item_key, r.rule_version, r.failure_mode, r.is_floor]),
    )
  );

  return { rules, blockingItemKeys, snapshotSha, statements };
}

export interface PersistEvaluationInput {
  feedbackId: string;
  results: ChecklistItemResult[];
  snapshotSha: string;
  pathsSha: string;
  registrySha: string;
  llmCallId?: string | null;
  decidedBy?: string | null;
}

/**
 * Write one row per item.
 *
 * Uses ON DUPLICATE KEY UPDATE against uq_uat_eval so a re-evaluation (a second attempt, or
 * a human overriding an LLM verdict) replaces the row instead of failing. The audit history
 * lives in uat_feedback_event, which is append-only; duplicating it here would give two
 * disagreeing timelines.
 */
export async function persistEvaluations(
  input: PersistEvaluationInput,
  conn?: UatConnection
): Promise<number> {
  if (!input.results.length) return 0;
  const runner = conn ?? db;
  let written = 0;

  for (const r of input.results) {
    await runner.query(
      `INSERT INTO uat_checklist_evaluation
         (feedback_id, item_key, verdict, source, evidence, confidence,
          llm_call_id, decided_by, rule_version, rule_snapshot_sha256, paths_sha, registry_sha)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         verdict = VALUES(verdict), source = VALUES(source), evidence = VALUES(evidence),
         confidence = VALUES(confidence), llm_call_id = VALUES(llm_call_id),
         decided_by = VALUES(decided_by), rule_version = VALUES(rule_version),
         rule_snapshot_sha256 = VALUES(rule_snapshot_sha256),
         paths_sha = VALUES(paths_sha), registry_sha = VALUES(registry_sha)`,
      [
        input.feedbackId,
        r.itemKey,
        r.verdict,
        r.source,
        (r.evidence ?? "").slice(0, 4000),
        r.confidence ?? null,
        input.llmCallId ?? null,
        input.decidedBy ?? null,
        r.ruleVersion ?? null,
        input.snapshotSha,
        input.pathsSha,
        input.registrySha,
      ]
    );
    written++;
  }
  return written;
}

/**
 * Promote the scan's capability hits into their own table.
 *
 * They already exist as JSON on uat_static_scan; this copy makes "how often does the
 * leave-accrual capability fire, and on which signal" a query rather than a JSON scan across
 * every row — which is the input to tuning the registry from real data instead of theory.
 *
 * Deletes this feedback's prior rows first so a re-scan replaces rather than accumulates.
 */
export async function persistCapabilityHits(
  feedbackId: string,
  scan: StaticScanResult,
  scanId: string | null,
  conn?: UatConnection
): Promise<number> {
  const runner = conn ?? db;
  await runner.query(`DELETE FROM uat_capability_hit WHERE feedback_id = ?`, [feedbackId]);

  const hits: CapabilityHit[] = scan.capabilityHits ?? [];
  for (const h of hits) {
    await runner.query(
      `INSERT INTO uat_capability_hit
         (feedback_id, scan_id, capability_key, capability_class, match_signal, matched_token)
       VALUES (?,?,?,?,?,?)`,
      [feedbackId, scanId, h.capabilityKey, h.class, h.signal, String(h.matchedToken).slice(0, 300)]
    );
  }
  return hits.length;
}
