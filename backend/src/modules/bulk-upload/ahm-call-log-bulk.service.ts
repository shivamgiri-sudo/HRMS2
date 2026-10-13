import { createHash, randomUUID } from "crypto";
import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";
import { withDeadlockRetry } from "../../shared/deadlockRetry.js";
import { getByColumn, str, strNum, parseAhmDateTime } from "./ahm-dump-bulk.service.js";

/**
 * AHM call-attempt log -- writes into mas_hrms.ahm_call_log (sql/migrations/2155). One row per dial by a telesales agent.
 *
 * The real file's header names were not available when this was built, so every column is matched through a list of
 * plausible spellings (case/space/punctuation-insensitive, see getByColumn) and the importer only insists on the two
 * things a call cannot be used without: the agent and the call time.
 *
 * Each call is classified ONCE here, so the dashboard and the KPI roll-up never re-interpret free text:
 *   is_connected  -- the call reached a person. From Call Status / Disposition text; failing that, talk time > 0.
 *   is_productive -- the call produced an order/survey. An explicit Productive / Order Taken flag wins, else the text.
 *   is_incoming   -- the customer called in. From Call Type / Direction; NULL when the file does not say.
 * A classification the file gives no evidence for is NULL, never a guessed 0, and is left out of that rate's denominator.
 *
 * Identity: call_key = sha1(time, agent, outlet/phone, type, duration, status, disposition) + an ordinal for genuinely
 * identical rows inside one file, so re-uploading a file upserts instead of doubling every rate.
 */

export const CALL_COLUMNS = {
  time: ["Call Date", "Call Time", "Call Start Time", "Start Time", "Date Time", "DateTime", "Timestamp", "Date", "Call Date Time"],
  agent: ["Telesales ID", "TeleSales Id", "Agent ID", "Agent Id", "Agent", "Agent Name", "User ID", "User", "Username", "Employee ID", "Emp ID", "MAS ID"],
  outlet: ["Outlet ID", "Outlet Code", "Outlet"],
  phone: ["Phone Number", "Phone No", "Phone", "Mobile", "Mobile Number", "Customer Number", "Dialed Number", "Called Number", "Destination", "Number"],
  type: ["Call Type", "Call Direction", "Direction", "Inbound/Outbound", "Type"],
  status: ["Call Status", "Call Result", "Connect Status", "Call Outcome", "Status"],
  disposition: ["Disposition", "Call Disposition", "Last disposition Status", "Dispo", "Sub Disposition"],
  duration: ["Duration", "Call Duration", "Talk Time", "Talk Duration", "Duration (sec)", "Talk Sec", "Length"],
  productive: ["Productive", "Productive Call", "Is Productive", "Order Taken", "PC"],
  zone: ["Zone"],
  region: ["Region", "Branch"],
} as const;

const NOT_CONNECTED = /not\s*connect|no\s*answer|unanswer|not\s*answer|busy|switch(ed)?\s*off|not\s*reachable|unreachable|out\s*of\s*(coverage|reach)|wrong\s*number|invalid|fail|abandon|missed|drop(ped)?\b|disconnect|no\s*response|ringing/i;
const CONNECTED = /connect|answer|picked|received|talk|success|survey\s*taken|order|productive|delivered|interested|callback|call\s*back|follow/i;
const NOT_PRODUCTIVE = /no\s*order|not\s*interested|order\s*not|not\s*productive|unproductive|refus|reject|cancel/i;
const PRODUCTIVE = /order|survey\s*taken|productive|booked|sale/i;
const TRUTHY = /^(1|y|yes|true|t|productive|order)$/i;
const FALSY = /^(0|n|no|false|f|unproductive|none)$/i;
const INCOMING = /in\s*-?\s*(bound|coming)|\bincoming\b|\binbound\b|^in$|^ib$|received|customer\s*call/i;
const OUTGOING = /out\s*-?\s*(bound|going)|\boutgoing\b|\boutbound\b|^out$|^ob$|^dialed$|^dialled$|^manual$|predictive|progressive/i;

export type CallClassification = { isConnected: 0 | 1 | null; isProductive: 0 | 1 | null; isIncoming: 0 | 1 | null };

/** Excel day-fraction, plain seconds ("85"), "mm:ss" or "h:mm:ss" -> whole seconds; null when blank/unreadable. */
export function parseDurationSec(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) {
    const p = s.split(":").map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 0 && n < 1 ? Math.round(n * 86400) : Math.round(n);
}

export function classifyCall(i: { status: string | null; disposition: string | null; durationSec: number | null; callType: string | null; productiveFlag: string | null }): CallClassification {
  const text = [i.status, i.disposition].filter(Boolean).join(" | ");
  let isConnected: 0 | 1 | null = null;
  if (text) {
    if (NOT_CONNECTED.test(text)) isConnected = 0;
    else if (CONNECTED.test(text)) isConnected = 1;
  }
  if (isConnected === null && i.durationSec !== null) isConnected = i.durationSec > 0 ? 1 : 0;

  let isProductive: 0 | 1 | null = null;
  const flag = (i.productiveFlag ?? "").trim();
  if (flag && TRUTHY.test(flag)) isProductive = 1;
  else if (flag && FALSY.test(flag)) isProductive = 0;
  else if (i.disposition) {
    if (NOT_PRODUCTIVE.test(i.disposition)) isProductive = 0;
    else if (PRODUCTIVE.test(i.disposition)) isProductive = 1;
    else isProductive = 0;
  } else if (isConnected === 0) isProductive = 0;
  // A call that did not connect cannot have produced an order.
  if (isConnected === 0) isProductive = 0;

  let isIncoming: 0 | 1 | null = null;
  const t = (i.callType ?? "").trim();
  if (t) {
    if (INCOMING.test(t)) isIncoming = 1;
    else if (OUTGOING.test(t)) isIncoming = 0;
  }
  return { isConnected, isProductive, isIncoming };
}

export function callKey(parts: Array<string | number | null>, ordinal: number): string {
  return createHash("sha1").update(parts.map((p) => String(p ?? "")).join("␟") + `␟${ordinal}`).digest("hex");
}

interface BatchRow extends RowDataPacket { id: string; row_no: number; normalized_data: string | Record<string, unknown> }
interface Ref extends RowDataPacket { id: string }

const COLUMNS = `id, process_id, call_key, call_time, call_date, telesales_id, outlet_id, phone, call_type, call_status,
  disposition, duration_sec, is_connected, is_productive, is_incoming, zone, region, upload_batch_id, created_by`;
const UPSERT = `ON DUPLICATE KEY UPDATE call_status = VALUES(call_status), disposition = VALUES(disposition),
  duration_sec = VALUES(duration_sec), is_connected = VALUES(is_connected), is_productive = VALUES(is_productive),
  is_incoming = VALUES(is_incoming), zone = VALUES(zone), region = VALUES(region),
  upload_batch_id = VALUES(upload_batch_id), created_by = VALUES(created_by)`;

export async function importAhmCallLogBatch(batchId: string, importedByUserId: string) {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] as string[] };

  const [procRows] = await db.execute<Ref[]>("SELECT id FROM process_master WHERE process_code = 'AHM' AND active_status = 1 LIMIT 1");
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];
  const seen = new Map<string, number>();
  const fail = (row: BatchRow, msg: string) => { errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); };

  for (const row of batchRows) {
    const data = typeof row.normalized_data === "string" ? JSON.parse(row.normalized_data) : ((row.normalized_data ?? {}) as Record<string, unknown>);
    if (!processId) { fail(row, `Row ${row.row_no}: no active "AHM" process found to attach this row to`); continue; }
    const agent = str(data, ...CALL_COLUMNS.agent);
    if (!agent) { fail(row, `Row ${row.row_no}: no agent column found (expected one of Telesales ID / Agent ID / Agent / User ID)`); continue; }
    const callTime = parseAhmDateTime(data, ...CALL_COLUMNS.time);
    if (!callTime) { fail(row, `Row ${row.row_no}: no readable call date/time (expected Call Date / Call Time / Date)`); continue; }

    const outlet = str(data, ...CALL_COLUMNS.outlet);
    const phone = strNum(data, ...CALL_COLUMNS.phone);
    const callType = str(data, ...CALL_COLUMNS.type);
    const status = str(data, ...CALL_COLUMNS.status);
    const disposition = str(data, ...CALL_COLUMNS.disposition);
    const durationSec = parseDurationSec(getByColumn(data, ...CALL_COLUMNS.duration));
    const productiveFlag = str(data, ...CALL_COLUMNS.productive);
    const c = classifyCall({ status, disposition, durationSec, callType, productiveFlag });

    const identity = [callTime, agent.toUpperCase(), outlet ?? phone, callType, durationSec, status, disposition];
    const base = identity.join("|");
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);

    insertRows.push({
      rowId: row.id, rowNo: row.row_no,
      values: [
        randomUUID(), processId, callKey(identity, ordinal), callTime, callTime.slice(0, 10), agent, outlet, phone,
        callType, status, disposition, durationSec, c.isConnected, c.isProductive, c.isIncoming,
        str(data, ...CALL_COLUMNS.zone), str(data, ...CALL_COLUMNS.region), batchId, importedByUserId || null,
      ],
    });
  }

  const placeholders = COLUMNS.split(",").map(() => "?").join(", ");
  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO ahm_call_log (${COLUMNS})`,
    placeholderGroup: `(${placeholders})`,
    rows: insertRows,
    insertSuffix: UPSERT,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  const ERROR_MARK_CHUNK = 500;
  for (let offset = 0; offset < errorUpdates.length; offset += ERROR_MARK_CHUNK) {
    const chunk = errorUpdates.slice(offset, offset + ERROR_MARK_CHUNK);
    const cases = chunk.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = chunk.map((u) => u.rowId);
    await withDeadlockRetry(() => db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...chunk.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    ));
  }

  const finalStatus = errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await withDeadlockRetry(() => db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  ));
  return { importedRows, errorRows, errors };
}
