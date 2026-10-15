import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { COLUMN_MAP } from "../../bulk-upload/alt-rx-dump-bulk.service.js";
import { EXPECTED_COLUMNS, type DumpRow } from "./alt-rx.engine.js";

/**
 * Reads the saved ALT RX Dump (db_masmis.altdump).
 *
 * Dashboard reads are filtered in SQL on created_time and load only the eight columns the
 * dashboard uses, so a date range touches just its own rows. Results are cached in memory per
 * batch and range for CACHE_MS. A new upload has a new batch id, so the cache is dropped as
 * soon as the data changes.
 *
 * The MIS download still reads every column, because its Dump sheet reproduces the upload.
 */

export interface StoredBatch {
  batchId: string;
  fileName: string;
  uploadedAt: string;
  importedRows: number;
}

export interface StoredDump {
  batch: StoredBatch | null;
  columns: string[];
  rows: DumpRow[];
}

const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 30;
const cache = new Map<string, { at: number; rows: DumpRow[] }>();

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  return String(v);
};
const dayOf = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v).slice(0, 10);
};

export async function loadStoredBatch(): Promise<StoredBatch | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, original_file_name, imported_rows, COALESCE(imported_at, created_at) AS uploaded_at
       FROM upload_batch
      WHERE upload_type_code = 'ALT_RX_DUMP_MASMIS' AND batch_status IN ('imported','imported_with_errors')
      ORDER BY COALESCE(imported_at, created_at) DESC LIMIT 1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    batchId: String(r.id),
    fileName: String(r.original_file_name ?? ""),
    uploadedAt: stamp(r.uploaded_at) ?? "",
    importedRows: Number(r.imported_rows ?? 0),
  };
}

/** First and last created day of a batch, from the created_time index. */
export async function getBatchSpan(batchId: string): Promise<{ from: string | null; to: string | null }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT MIN(created_time) AS first_t, MAX(created_time) AS last_t FROM db_masmis.altdump WHERE upload_batch_id = ?`,
    [batchId],
  );
  return { from: dayOf(rows[0]?.first_t), to: dayOf(rows[0]?.last_t) };
}

/** Dashboard rows for a batch and an inclusive created-day range, read with only the fields the engine uses. */
export async function loadDashboardRows(batchId: string, from: string | null, to: string | null): Promise<DumpRow[]> {
  const key = `${batchId}|${from ?? ""}|${to ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  const conditions = ["upload_batch_id = ?"];
  const params: unknown[] = [batchId];
  if (from) { conditions.push("created_time >= ?"); params.push(`${from} 00:00:00`); }
  if (to) { conditions.push("created_time < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(`${to} 00:00:00`); }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ticket_id, status, agent, ticket_type, source_info, created_time, initial_response_time, resolved_time
       FROM db_masmis.altdump WHERE ${conditions.join(" AND ")} ORDER BY id`,
    params,
  );
  const out: DumpRow[] = rows.map((r) => ({
    "Ticket ID": r.ticket_id ?? null,
    Status: r.status ?? null,
    Agent: r.agent ?? null,
    Type: r.ticket_type ?? null,
    "Source Info": r.source_info ?? null,
    "Created time": r.created_time ?? null,
    "Initial response time": r.initial_response_time ?? null,
    "Resolved time": r.resolved_time ?? null,
  }));

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), rows: out });
  return out;
}

/** Every column of the batch, for the MIS download (its Dump sheet reproduces the upload). */
export async function loadStoredDump(): Promise<StoredDump> {
  const batch = await loadStoredBatch();
  if (!batch) return { batch: null, columns: [...EXPECTED_COLUMNS], rows: [] };

  const columnSql = COLUMN_MAP.map(([, column]) => column).join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT row_no, ${columnSql}, extra_json FROM db_masmis.altdump WHERE upload_batch_id = ? ORDER BY id`,
    [batch.batchId],
  );

  const extraKeys = new Set<string>();
  const out: DumpRow[] = rows.map((r) => {
    const rec: DumpRow = {};
    for (const [header, column] of COLUMN_MAP) rec[header] = r[column] ?? null;
    if (r.extra_json) {
      const extra = typeof r.extra_json === "string" ? JSON.parse(r.extra_json) : (r.extra_json as Record<string, unknown>);
      for (const k of Object.keys(extra)) { extraKeys.add(k); rec[k] = extra[k]; }
    }
    return rec;
  });
  return { batch, columns: [...EXPECTED_COLUMNS, ...extraKeys], rows: out };
}
