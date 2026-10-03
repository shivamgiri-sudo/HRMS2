import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { flushDalmiaRows } from "./dalmia-chunk-import.js";
import type { ChunkInsertRow } from "./masmis-chunked-insert.js";
import { canonicalizeRow } from "./dalmia-import-helpers.js";
import { applyPlan, buildColumnPlan, describePlan, type ColumnSpec, type PlanOptions } from "./report-column-plan.js";

/** Process this whole pipeline attaches rows to (process_master.process_name). */
export const SBI_CARD_PROCESS_NAME = "SBI Card Collections";

export type SbiRowResult =
  /** `notes` are short, row-independent remarks ("LOGIN TIME derived from the state times"); the runner counts and reports them. */
  | { values: unknown[]; notes?: string[] }
  | { error: string }
  | { skip: true };

export interface SbiBatchSpec {
  table: string;
  /** Every column of the INSERT, in order; the first three of each row's values are id, process_id, ... as the mapper builds them. */
  columns: string[];
  /** Columns refreshed on a re-upload of the same natural key. */
  updateColumns: string[];
  headers: readonly string[];
  /** Layouts that drift (reordered / renamed / missing columns): map the file's headers onto the importer's before mapping rows. */
  columnSpecs?: ColumnSpec[];
  planOptions?: PlanOptions;
  /** Turns one canonicalised row into the INSERT values (after the id and process_id), or an error / skip. */
  mapRow: (data: Record<string, unknown>, rowNo: number, ctx: { processId: string; batchId: string; userId: string }) => SbiRowResult;
  /** Runs after the rows are written (e.g. KPI daily rollups); a failure here must not fail the import. */
  afterImport?: (processId: string, importedDates: string[]) => Promise<void>;
  /** Extracts the report date (YYYY-MM-DD) from a written row's values, for afterImport. */
  dateOf?: (values: unknown[]) => string | null;
}

interface BatchRow extends RowDataPacket { id: string; row_no: number; normalized_data: string | Record<string, unknown> }
interface Ref extends RowDataPacket { id: string }

export const upsertSuffix = (cols: string[]): string =>
  `ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(", ")}`;

/** Shared loop of the five SBI Card importers: read staged rows, map each, flush as chunked upserts, close the batch. */
export async function runSbiBatch(
  batchId: string,
  userId: string,
  spec: SbiBatchSpec,
  newId: () => string,
): Promise<{ importedRows: number; errorRows: number; errors: string[]; notes?: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    const [staged] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`, [batchId]);
    if (Number((staged as RowDataPacket[])[0]?.n ?? 0) === 0) {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed',
            error_summary = 'No rows were staged for this batch -- the upload''s row-staging step likely failed or timed out. Re-upload the file.',
            updated_at = NOW() WHERE id = ?`,
        [batchId],
      );
    }
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const [procRows] = await db.execute<Ref[]>(
    // By CODE first: migration 1985 merged the duplicate onto the real process ("SBI Credit Cards"), which took the code SBI_CARD, so the
    // name "SBI Card Collections" no longer exists in production. The dashboard resolves by code too. The name is only a fallback.
    `SELECT id FROM process_master WHERE active_status = 1 AND (process_code = 'SBI_CARD' OR process_name = ?)
      ORDER BY (process_code = 'SBI_CARD') DESC LIMIT 1`,
    [SBI_CARD_PROCESS_NAME],
  );
  const processId = procRows[0]?.id ?? null;

  const parsed = new Map<string, Record<string, unknown>>();
  for (const row of batchRows) parsed.set(row.id, typeof row.normalized_data === "string" ? JSON.parse(row.normalized_data) : ((row.normalized_data ?? {}) as Record<string, unknown>));
  const notes: string[] = [];
  let plan: ReturnType<typeof buildColumnPlan> | null = null;
  if (spec.columnSpecs) {
    plan = buildColumnPlan([...parsed.values()].slice(0, 300), spec.columnSpecs, spec.planOptions);
    if (plan.fatal) {
      await db.execute(`UPDATE upload_batch SET batch_status = 'validation_failed', error_summary = ?, updated_at = NOW() WHERE id = ?`, [plan.fatal.slice(0, 1000), batchId]);
      return { importedRows: 0, errorRows: batchRows.length, errors: [plan.fatal], notes: [] };
    }
    notes.push(...describePlan(plan, spec.columnSpecs.length));
  }
  const rowNotes = new Map<string, number>();

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const skipped: string[] = [];
  const insertRows: ChunkInsertRow[] = [];
  const dates = new Set<string>();

  for (const row of batchRows) {
    if (!processId) {
      const msg = `Row ${row.row_no}: no active SBI Card process (code SBI_CARD) found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    const raw = parsed.get(row.id)!;
    const data = canonicalizeRow(plan ? applyPlan(raw, plan) : raw, spec.headers);
    const res = spec.mapRow(data, row.row_no, { processId, batchId, userId });
    if ("error" in res) {
      const msg = `Row ${row.row_no}: ${res.error}`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    if ("skip" in res) { skipped.push(row.id); continue; }
    for (const n of res.notes ?? []) rowNotes.set(n, (rowNotes.get(n) ?? 0) + 1);
    const d = spec.dateOf?.(res.values);
    if (d) dates.add(d);
    insertRows.push({ rowId: row.id, rowNo: row.row_no, values: [newId(), processId, ...res.values] });
  }

  for (let i = 0; i < skipped.length; i += 500) {
    const part = skipped.slice(i, i + 500);
    await db.execute(`UPDATE upload_batch_row SET row_status = 'skipped' WHERE id IN (${part.map(() => "?").join(",")})`, part);
  }

  const result = await flushDalmiaRows({
    batchId, table: spec.table, columns: spec.columns, suffix: upsertSuffix(spec.updateColumns),
    rows: insertRows, errorUpdates, errors,
  });

  if (spec.afterImport && processId && result.importedRows > 0 && dates.size > 0) {
    try { await spec.afterImport(processId, [...dates]); } catch (e) {
      result.errors.push(`Imported, but the KPI daily rollup failed: ${(e as Error).message}`);
    }
  }
  for (const [n, c] of [...rowNotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) notes.push(`${n} (${c} row${c === 1 ? "" : "s"}).`);
  if (notes.length > 0) {
    try { await db.execute(`UPDATE upload_batch SET error_summary = COALESCE(NULLIF(error_summary, ''), ?) WHERE id = ?`, [notes.join(" ").slice(0, 1000), batchId]); } catch { /* the report is a courtesy; the import already finished */ }
  }
  return { ...result, notes };
}
