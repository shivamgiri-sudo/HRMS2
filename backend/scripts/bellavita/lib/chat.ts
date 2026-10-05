/**
 * Bellavita Chat (db_masmis.new_bb_chat) check-and-insert.
 *
 * The older db_masmis.bb_chat is intentionally left untouched (per
 * bb-chat-masmis-bulk.service.ts's own doc comment -- the Bellavita Chat
 * dashboard, Sales Upload module and the separate My Dashboards tool still
 * read it); new_bb_chat is the live table for new chat file uploads.
 *
 * IMPORTANT -- Unique ID is NOT a per-row key, it repeats on purpose.
 * Confirmed live 2026-09-29: the same Unique ID appears more than once when a
 * customer contacts again -- the first row has Repeat Status "Unique", the
 * follow-up has "Repeat", with a genuinely different FRT/Resolution
 * Time/Hour/agent etc. An earlier version of this script deduped by Unique ID
 * alone (keep the last occurrence), which silently discarded every
 * first-contact row of a repeat pair -- 500 real rows out of one 3,636-row
 * file. The fix: a row only counts as "already imported" when (unique_id,
 * frt, resolution_time_in_min) all match an existing row -- frt/
 * resolution_time_in_min are decimal(12,2) in the table, so the file's own
 * values are rounded to 2dp before comparing (verified collision-free: only
 * 7 of 3,636 real rows in that same file happen to round to the same key as
 * another row -- an accepted, tiny, explained gap, not a sign the key is
 * unreliable). Never updates existing rows, only inserts new ones -- chat
 * rows have no "status that changes later" concept the way bb_sale does.
 *
 * Reuses mapBbChatRow/NEW_BB_CHAT_COLUMNS/NEW_BB_CHAT_TABLE from the real
 * uploader service, so this is exactly the same column mapping a browser
 * upload through the app would produce (including the Fraud/Froud and
 * Disposition/Dispostion header-typo aliases fixed 2026-09-28).
 */
import XLSX from "xlsx";
import { db } from "../../../src/db/mysql.js";
import { mapBbChatRow, NEW_BB_CHAT_COLUMNS, NEW_BB_CHAT_TABLE } from "../../../src/modules/bulk-upload/bb-chat-masmis-bulk.service.js";

export interface ChatUploadOptions { execute: boolean }
export interface ChatUploadResult { totalRows: number; mappingErrors: number; distinctInFile: number; alreadyInDb: number; inserted: number; errors: number }

export async function runChatUpload(filePath: string, opts: ChatUploadOptions): Promise<ChatUploadResult> {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  console.log(`[chat] Read ${rows.length} rows from ${filePath}`);

  const mapped = rows.map((r, i) => ({ row: r, result: mapBbChatRow(r, i + 2) }));
  const badRows = mapped.filter((m) => !m.result.ok);
  const goodRows = mapped.filter((m) => m.result.ok) as Array<{ row: Record<string, unknown>; result: { ok: true; values: Array<string | number | null> } }>;
  console.log(`[chat] Rows that mapped cleanly: ${goodRows.length} (mapping errors: ${badRows.length})`);
  if (badRows.length > 0) console.log("[chat] Sample errors:", badRows.slice(0, 5).map((m) => (m.result as { ok: false; error: string }).error));

  const uniqueIdIdx = NEW_BB_CHAT_COLUMNS.indexOf("unique_id");
  const frtIdx = NEW_BB_CHAT_COLUMNS.indexOf("frt");
  const resIdx = NEW_BB_CHAT_COLUMNS.indexOf("resolution_time_in_min");
  const round2 = (v: unknown): string => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : ""; };
  const compositeKey = (values: Array<string | number | null>) => `${values[uniqueIdIdx]}|${round2(values[frtIdx])}|${round2(values[resIdx])}`;

  // Within-file de-dup is by the FULL composite key (unique_id + rounded frt + rounded
  // resolution time), not by unique_id alone -- two rows sharing a unique_id are almost
  // always two real, different interactions (see file header comment), so only an exact
  // composite match (an actual re-exported duplicate row) collapses to one.
  const byKey = new Map<string, (typeof goodRows)[number]>();
  for (const m of goodRows) byKey.set(compositeKey(m.result.values), m);
  const deduped = [...byKey.values()];
  console.log(`[chat] Distinct (unique_id, frt, resolution_time) rows in file: ${deduped.length} (exact re-exported dupes collapsed: ${goodRows.length - deduped.length})`);

  const idArr = [...new Set(deduped.map((m) => String(m.result.values[uniqueIdIdx])))];
  const existingKeys = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < idArr.length; i += CHUNK) {
    const chunk = idArr.slice(i, i + CHUNK);
    const [existRows] = await db.execute<any[]>(
      `SELECT unique_id, frt, resolution_time_in_min FROM ${NEW_BB_CHAT_TABLE} WHERE unique_id IN (${chunk.map(() => "?").join(",")})`, chunk,
    );
    for (const r of existRows) existingKeys.add(`${r.unique_id}|${round2(r.frt)}|${round2(r.resolution_time_in_min)}`);
  }
  const newRows = deduped.filter((m) => !existingKeys.has(compositeKey(m.result.values)));
  console.log(`[chat] Of file's rows, already in new_bb_chat (same unique_id + frt + resolution time): ${deduped.length - newRows.length}`);
  console.log(`[chat] NEW (not yet imported): ${newRows.length}`);

  if (!opts.execute) {
    console.log("[chat] DRY RUN -- no writes made.");
    return { totalRows: rows.length, mappingErrors: badRows.length, distinctInFile: deduped.length, alreadyInDb: deduped.length - newRows.length, inserted: 0, errors: 0 };
  }

  const columns = [...NEW_BB_CHAT_COLUMNS, "uploaded_by", "upload_batch_id"];
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  let inserted = 0;
  let errors = 0;
  const CHUNK_INSERT = 200;
  for (let i = 0; i < newRows.length; i += CHUNK_INSERT) {
    const chunk = newRows.slice(i, i + CHUNK_INSERT);
    try {
      const values = chunk.map((m) => [...m.result.values, null, null]);
      const sql = `INSERT INTO ${NEW_BB_CHAT_TABLE} (${columns.join(", ")}) VALUES ${chunk.map(() => placeholders).join(", ")}`;
      await db.execute(sql, values.flat());
      inserted += chunk.length;
    } catch (e) {
      console.warn(`[chat] Chunk insert failed (rows ${i}-${i + chunk.length}):`, e instanceof Error ? e.message : e);
      errors += chunk.length;
    }
  }

  if (inserted > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) VALUES (UUID(), 'new_bb_chat', ?, ?, NULL)`,
      [filePath, inserted],
    );
  }

  console.log(`[chat] Done. Inserted ${inserted} rows (${errors} errors).`);
  return { totalRows: rows.length, mappingErrors: badRows.length, distinctInFile: deduped.length, alreadyInDb: deduped.length - newRows.length, inserted, errors };
}
