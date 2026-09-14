import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Per-process delivery actuals.
 *
 * process_delivery_actual already exists and is already read by the P&L
 * (bpo-pnl.service.ts, process-lob-commercial.service.ts) — it has simply never
 * had a writer, so it holds zero rows. This is that writer.
 *
 * It matters most for the processes that are not call centres. Godfrey Philips
 * runs 1,999 people with no dialler and no APR feed, and its WFM team keeps
 * "Order vs Delivery" and "Order vs Delivery SKU wise" in Excel; a field force
 * produces delivered units, not calls, and this is the only table shaped for that.
 *
 * Rows land as status='draft'. The P&L already distinguishes draft from validated,
 * and an uploaded number should not become a billable actual because somebody
 * dragged a spreadsheet into a browser — validation stays a separate, deliberate act.
 */

export const PROCESS_DELIVERY_HEADERS = [
  "Process Code",
  "LOB",
  "Period",
  "Activity Date",
  "Metric",
  "Planned Units",
  "Delivered Units",
  "Accepted Units",
  "Rejected Units",
  "Billable Units",
  "Productive Hours",
  "Login Hours",
  "Talk Minutes",
  "Quality Score",
  "SLA Score",
] as const;

const NUMERIC: Array<{ column: string; header: string }> = [
  { column: "planned_units", header: "Planned Units" },
  { column: "delivered_units", header: "Delivered Units" },
  { column: "accepted_units", header: "Accepted Units" },
  { column: "rejected_units", header: "Rejected Units" },
  { column: "billable_units", header: "Billable Units" },
  { column: "productive_hours", header: "Productive Hours" },
  { column: "login_hours", header: "Login Hours" },
  { column: "talk_minutes", header: "Talk Minutes" },
];

/** These four are NOT NULL with a 0 default, so a blank cell means zero, not null. */
export function parseUnits(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** quality_score and sla_score are nullable: "not measured" is not the same as zero. */
export function parseScore(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace("%", "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 0 && n <= 1 ? Math.round(n * 10000) / 100 : n;
}

/** Accepts 2026-09, 09-2026 and Sep-2026; period_code is char(7) as YYYY-MM. */
export function parsePeriod(raw: unknown, activityDate: string | null): string | null {
  const v = String(raw ?? "").trim();
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let m = /^(\d{4})-(\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})-(\d{4})$/.exec(v);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = /^([A-Za-z]{3})[a-z]*-(\d{4})$/.exec(v);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}`;
  }
  // Derived from the activity date rather than rejected: a daily sheet that names
  // the day but not the month still belongs to exactly one period.
  return activityDate ? activityDate.slice(0, 7) : null;
}

export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string; k: string }

export async function importProcessDeliveryBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  // Resolved by code, never created. A delivery row against a process that does not
  // exist is a typo, and inventing the process to accept the row would put numbers
  // into the P&L under a client nobody recognises.
  const [procRows] = await db.execute<Ref[]>(
    "SELECT id, UPPER(process_code) k FROM process_master WHERE active_status = 1",
  );
  const processByCode = new Map(procRows.map((r) => [r.k, r.id]));
  // Keyed by process AND name: process_lob_master is scoped to a process, and two
  // clients can both call a line of business "Inbound". A name-only lookup would
  // attach one client's delivery to another client's LOB.
  const [lobRows] = await db.execute<Ref[]>(
    "SELECT id, CONCAT(process_id, '|', UPPER(lob_name)) k FROM process_lob_master WHERE active_status = 1",
  );
  const lobByKey = new Map(lobRows.map((r) => [r.k, r.id]));

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const code = String(data["Process Code"] ?? "").trim().toUpperCase();
    const processId = processByCode.get(code);
    if (!processId) {
      const msg = `Row ${row.row_no}: no active process with code "${code || "(blank)"}"`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const metric = String(data["Metric"] ?? "").trim();
    if (!metric) {
      const msg = `Row ${row.row_no}: "Metric" is required — it is part of the row's identity`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const activityDate = parseDate(data["Activity Date"]);
    const period = parsePeriod(data["Period"], activityDate);
    if (!period) {
      const msg = `Row ${row.row_no}: needs a "Period" (YYYY-MM) or a readable "Activity Date"`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const lobName = String(data["LOB"] ?? "").trim().toUpperCase();
    const lobId = lobName ? (lobByKey.get(`${processId}|${lobName}`) ?? null) : null;

    const units = NUMERIC.map((n) => parseUnits(data[n.header]));

    try {
      await db.execute(
        `INSERT INTO process_delivery_actual
           (id, process_id, process_lob_id, period_code, activity_date, metric_key,
            ${NUMERIC.map((n) => n.column).join(", ")},
            quality_score, sla_score, data_source, source_reference, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ${NUMERIC.map(() => "?").join(", ")}, ?, ?, 'bulk_upload', ?, 'draft', ?, ?)
         ON DUPLICATE KEY UPDATE
            activity_date = VALUES(activity_date),
            ${NUMERIC.map((n) => `${n.column} = VALUES(${n.column})`).join(", ")},
            quality_score = VALUES(quality_score),
            sla_score = VALUES(sla_score),
            updated_by = VALUES(updated_by)`,
        [
          randomUUID(), processId, lobId, period, activityDate, metric,
          ...units,
          parseScore(data["Quality Score"]), parseScore(data["SLA Score"]),
          // source_reference is part of the unique key, so the batch id keeps one
          // upload from overwriting another's rows for the same process and metric.
          batchId,
          importedByUserId, importedByUserId,
        ] as never[],
      );
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${row.row_no}: ${msg}`);
      errorUpdates.push({ rowId: row.id, message: msg.slice(0, 500) });
      errorRows++;
    }
  }

  if (errorUpdates.length) {
    const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  return { importedRows, errorRows, errors };
}
