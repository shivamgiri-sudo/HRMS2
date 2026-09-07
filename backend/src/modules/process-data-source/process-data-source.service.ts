import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { findMetricDef } from "../process-performance/kpi-metric-registry.js";

/**
 * Write side for process_metric_actual — the figures a client supplies because
 * HRMS has no pipeline that can measure them.
 *
 * Two things are enforced here rather than in the UI, because the UI is not a
 * security boundary:
 *
 *   1. A caller may only write to a process inside their own scope, checked
 *      through the same buildScopeWhereClause predicate the read side uses.
 *   2. A caller may only write a metric the registry defines FOR THAT PROCESS.
 *      Without this, a typo creates an orphan metric_key that no dashboard
 *      reads and nobody ever notices — the silent-failure class this codebase
 *      keeps rediscovering.
 *
 * A blank value is stored as NULL, never coerced to 0. On this dashboard a 0
 * means "measured zero" and would score the process red for a figure that was
 * simply never sent.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Who may write at all. Row scope is then checked per process, below. */
const WRITER_ROLES = [
  "super_admin", "admin", "process_manager", "operations_manager",
];

/** Is this process inside the caller's own scope? A predicate, not UI state. */
export async function assertProcessWritable(userId: string, processId: string): Promise<boolean> {
  const scope = await buildScopeWhereClause(userId, WRITER_ROLES, {
    processId: "p.id", branchId: "p.branch_id",
  }, { allowAdminBypass: true });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id FROM process_master p WHERE p.id = ? AND (${scope.sql}) LIMIT 1`,
    [processId, ...scope.params],
  );
  return rows.length > 0;
}

async function processCodeFor(processId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_code FROM process_master WHERE id = ? LIMIT 1`, [processId],
  );
  return rows.length ? String(rows[0].process_code) : null;
}

export async function saveManualMetricValue(input: {
  userId: string;
  processId: string;
  metricKey: string;
  scoreDate: string;
  value: number | null;
  note?: string | null;
}): Promise<{ ok: true }> {
  if (!ISO_DATE.test(input.scoreDate)) throw new Error("Date must be YYYY-MM-DD");

  const processCode = await processCodeFor(input.processId);
  if (!processCode) throw new Error("Unknown process");

  // findMetricDef is scoped to the process, so a real key belonging to a
  // DIFFERENT client is rejected here too, not just a nonsense one.
  const def = findMetricDef(processCode, input.metricKey);
  if (!def) throw new Error(`${input.metricKey} is not a registered metric for ${processCode}`);

  await db.execute(
    `INSERT INTO process_metric_actual
       (id, process_id, metric_key, score_date, actual_value, source, note, created_by)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)
     ON DUPLICATE KEY UPDATE
       actual_value         = VALUES(actual_value),
       source               = 'manual',
       source_connector_key = NULL,
       note                 = VALUES(note),
       created_by           = VALUES(created_by)`,
    [
      randomUUID(), input.processId, input.metricKey, input.scoreDate,
      input.value, input.note?.trim() || null, input.userId,
    ],
  );
  return { ok: true };
}

export interface ProcessMetricRow {
  metricKey: string;
  scoreDate: string;
  value: number | null;
  source: string;
  note: string | null;
}

export async function listProcessMetricValues(
  processId: string, from: string, to: string,
): Promise<ProcessMetricRow[]> {
  // DATE_FORMAT, not the bare column: mysql2 returns a DATE as a JS Date whose
  // toString is "Fri Aug 01 2026 ...", which has already produced one live bug
  // in this module's sibling.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_key, DATE_FORMAT(score_date, '%Y-%m-%d') AS score_date,
            actual_value, source, note
       FROM process_metric_actual
      WHERE process_id = ? AND score_date BETWEEN ? AND ?
      ORDER BY score_date DESC, metric_key ASC
      LIMIT 500`,
    [processId, from, to],
  );
  return rows.map((r) => ({
    metricKey: String(r.metric_key),
    scoreDate: String(r.score_date),
    value: r.actual_value == null ? null : Number(r.actual_value),
    source: String(r.source),
    note: r.note == null ? null : String(r.note),
  }));
}

export interface ImportRow {
  metricKey: string;
  scoreDate: string;
  value: string | number | null;
  note?: string;
}

/**
 * Spreadsheet import. Every row is validated independently and a bad row is
 * reported by its own number rather than aborting the batch, because an ops
 * user pasting a month of figures should not lose 29 good rows to one typo.
 *
 * An empty value cell means "no reading" and is stored as NULL, for the same
 * reason single entry does it: 0 would be indistinguishable from a measured
 * zero on the dashboard.
 */
export async function importMetricRows(input: {
  userId: string;
  processId: string;
  rows: ImportRow[];
}): Promise<{ imported: number; errors: Array<{ row: number; message: string }> }> {
  const errors: Array<{ row: number; message: string }> = [];
  let imported = 0;

  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index];
    const raw = row?.value;
    const trimmed = typeof raw === "string" ? raw.trim() : raw;
    const value =
      trimmed === "" || trimmed === null || trimmed === undefined || Number.isNaN(Number(trimmed))
        ? null
        : Number(trimmed);
    try {
      await saveManualMetricValue({
        userId: input.userId,
        processId: input.processId,
        metricKey: String(row?.metricKey ?? "").trim(),
        scoreDate: String(row?.scoreDate ?? "").trim(),
        value,
        note: row?.note ?? null,
      });
      imported++;
    } catch (err) {
      errors.push({ row: index + 1, message: (err as Error).message });
    }
  }
  return { imported, errors };
}
