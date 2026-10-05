import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { COLUMN_MAP } from "../../bulk-upload/alt-rx-dump-bulk.service.js";
import { EXPECTED_COLUMNS, type DumpRow } from "./alt-rx.engine.js";

/**
 * Reads the saved ALT RX Dump (db_masmis.altdump) back as Dump rows, using the original headers,
 * so the same engine and MIS workbook serve both the dashboard and the download.
 *
 * The loaded Dump is kept in memory for CACHE_MS, keyed by upload batch. Changing the date range
 * then costs only the summary, not another read of ~40k rows. A new upload has a new batch id,
 * so the cache is dropped as soon as the data changes.
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
let cached: { batchId: string; stored: StoredDump; at: number } | null = null;

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  return String(v);
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

export async function loadStoredDump(): Promise<StoredDump> {
  const batch = await loadStoredBatch();
  if (!batch) return { batch: null, columns: [...EXPECTED_COLUMNS], rows: [] };

  if (cached && cached.batchId === batch.batchId && Date.now() - cached.at < CACHE_MS) {
    return { ...cached.stored, batch };
  }

  // Only the columns the dashboard and MIS use, in primary-key order (the key is indexed).
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

  const stored: StoredDump = { batch, columns: [...EXPECTED_COLUMNS, ...extraKeys], rows: out };
  cached = { batchId: batch.batchId, stored, at: Date.now() };
  return stored;
}
