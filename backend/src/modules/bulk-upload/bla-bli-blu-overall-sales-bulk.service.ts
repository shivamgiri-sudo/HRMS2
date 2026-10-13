import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { markRowsImported } from "./batch-row-status.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";
import {
  categoryOf, parseSalesNumber, planDateCorrections, rejectInFileDuplicates, rejectMessage, uploadSummary, validateSalesRow,
  type DateCorrection, type SalesRecord, type SalesReject,
} from "./bla-bli-blu-sales-validation.js";

/**
 * Blabli Blu's own "B-3 Dashboard" workbook family's "Overall Sales Raw"
 * sheet -- agent-attributed order-level sales data with no DB backing
 * anywhere (see sql/1729's own comment for the cross-schema check that
 * confirmed this). Row identity is the sheet's own "OrderID" column.
 *
 * Validation lives in bla-bli-blu-sales-validation.ts: each rejected row gets a stored reason code, field, value
 * and required format (bla_bli_blu_sales_upload_reject, sql 2170), and the per-date before/after counts of every
 * upload are kept for the correction view (bla_bli_blu_sales_upload_date).
 */

// Parsers kept importable from here: the abandon importer and the coercion tests use them.
export {
  BLA_BLI_BLU_OVERALL_SALES_HEADERS, cleanText, parseCallDurationSeconds, parseDate, parseDateTime,
} from "./bla-bli-blu-sales-validation.js";

/** Number or number-as-text ("1,234", "₹1,234") -> rounded integer; blank or unreadable -> null. */
export function parseNullableInt(raw: unknown): number | null {
  const p = parseSalesNumber(raw);
  return p.ok && p.value !== null ? Math.round(p.value) : null;
}

/** Number or number-as-text ("1,234.50", "₹1,234") -> number; blank or unreadable -> null. */
export function parseNullableDecimal(raw: unknown): number | null {
  const p = parseSalesNumber(raw);
  return p.ok ? p.value : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

const SALES = "bla_bli_blu_overall_sales_raw";
const CHUNK = 500;

function recordValues(r: SalesRecord, processId: string, batchId: string, userId: string): unknown[] {
  return [
    randomUUID(), processId, r.orderId, r.reportDate, r.week, r.empCode, r.empName, r.customerNumber, r.alternateNumber,
    r.paymentStatus, r.amount, r.campaign, r.callingStatus, r.discountCode, r.itemCount, r.currentStatus, r.lineitemSku,
    r.newSoldLineItem, r.newSoldCategory, r.leadLineItem, r.source, r.business, r.orderCreationTime, r.callDateTime,
    r.callDurationSeconds, r.callAttemptCount, r.createdBy, r.recordingLink, batchId, userId,
  ];
}

async function existingOrderIds(processId: string, orderIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const part = orderIds.slice(i, i + CHUNK);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT order_id FROM ${SALES} WHERE process_id = ? AND order_id IN (${part.map(() => "?").join(",")})`, [processId, ...part]);
    for (const r of rows) out.add(String(r.order_id));
  }
  return out;
}

async function countsByDate(processId: string, dates: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < dates.length; i += CHUNK) {
    const part = dates.slice(i, i + CHUNK);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, COUNT(*) AS n FROM ${SALES}
        WHERE process_id = ? AND report_date IN (${part.map(() => "?").join(",")}) GROUP BY d`, [processId, ...part]);
    for (const r of rows) out.set(String(r.d), Number(r.n));
  }
  return out;
}

/** Stores the structured rejects and warnings. Best effort: a database without sql 2170 still imports. */
async function saveRejects(batchId: string, rows: number[], rejects: SalesReject[], monthOfRow: Map<number, string>): Promise<void> {
  try {
    for (let i = 0; i < rows.length; i += 1000) {
      const part = rows.slice(i, i + 1000);
      await db.execute(`DELETE FROM bla_bli_blu_sales_upload_reject WHERE upload_batch_id = ? AND row_no IN (${part.map(() => "?").join(",")})`, [batchId, ...part]);
    }
    for (let i = 0; i < rejects.length; i += CHUNK) {
      const part = rejects.slice(i, i + CHUNK);
      await db.execute(
        `INSERT INTO bla_bli_blu_sales_upload_reject
           (upload_batch_id, row_no, field_name, uploaded_value, reason_code, reason, required_format, category, severity, report_month)
         VALUES ${part.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",")}`,
        part.flatMap((r) => [batchId, r.row, r.field, r.value, r.code, r.reason.slice(0, 500), r.requiredFormat, r.category, r.severity, monthOfRow.get(r.row) ?? null]));
    }
  } catch (e) {
    console.warn("[bla-bli-blu-overall-sales] reject log not stored:", e instanceof Error ? e.message : e);
  }
}

async function saveDateCorrections(batchId: string, processId: string, plan: DateCorrection[]): Promise<void> {
  if (!plan.length) return;
  try {
    const after = await countsByDate(processId, plan.map((p) => p.reportDate));
    await db.execute(
      `INSERT INTO bla_bli_blu_sales_upload_date
         (upload_batch_id, report_date, existing_count, upload_count, updated_count, inserted_count, after_count)
       VALUES ${plan.map(() => "(?,?,?,?,?,?,?)").join(",")}
       ON DUPLICATE KEY UPDATE upload_count = upload_count + VALUES(upload_count), updated_count = updated_count + VALUES(updated_count),
         inserted_count = inserted_count + VALUES(inserted_count), after_count = VALUES(after_count)`,
      plan.flatMap((p) => [batchId, p.reportDate, p.existingCount, p.uploadCount, p.updatedCount, p.insertedCount, after.get(p.reportDate) ?? 0]));
  } catch (e) {
    console.warn("[bla-bli-blu-overall-sales] correction counts not stored:", e instanceof Error ? e.message : e);
  }
}

export async function importBlaBliBluOverallSalesBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[]; warningRows?: number; summary?: ReturnType<typeof uploadSummary> & Record<string, unknown> }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    const [staged] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`,
      [batchId],
    );
    if (Number((staged as RowDataPacket[])[0]?.n ?? 0) === 0) {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed',
            error_summary = 'No rows were staged for this batch -- the upload''s row-staging step likely failed or timed out. Re-upload the file.',
            updated_at = NOW()
         WHERE id = ?`,
        [batchId],
      );
    }
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  // The process is looked up by its stored name; only the display spelling is "Blabli Blu".
  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const issues: SalesReject[] = [];
  const accepted: Array<{ rowId: string; rowNo: number; record: SalesRecord }> = [];
  const monthOfRow = new Map<number, string>();
  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);
    const v = validateSalesRow(data, row.row_no);
    if (v.record) monthOfRow.set(row.row_no, v.record.reportDate.slice(0, 7));
    if (!processId) {
      issues.push({
        row: row.row_no, field: "Process", value: "Bla Bli Blu", code: "PROCESS_NOT_FOUND",
        reason: "No active Blabli Blu process is configured in HRMS to attach this sale to. Ask an administrator.",
        requiredFormat: null, category: categoryOf("PROCESS_NOT_FOUND"), severity: "reject",
      });
      continue;
    }
    issues.push(...v.issues);
    if (v.record) accepted.push({ rowId: row.id, rowNo: row.row_no, record: v.record });
  }

  // Same OrderID twice in this file: keep the last, reject the earlier ones (never counted twice).
  const dupes = rejectInFileDuplicates(accepted.map((a) => ({ row: a.rowNo, orderId: a.record.orderId })));
  issues.push(...dupes);
  const superseded = new Set(dupes.map((d) => d.row));
  const toImport = accepted.filter((a) => !superseded.has(a.rowNo));

  // Before/after per date for the correction view, and which orders this file updates rather than adds.
  let plan: DateCorrection[] = [];
  if (processId && toImport.length) {
    const ids = [...new Set(toImport.map((a) => a.record.orderId))];
    const dates = [...new Set(toImport.map((a) => a.record.reportDate))];
    const [existingIds, before] = await Promise.all([existingOrderIds(processId, ids), countsByDate(processId, dates)]);
    plan = planDateCorrections(toImport.map((a) => a.record), before, existingIds);
    // Keep the current version of every order this file is about to replace, so a change stays traceable and a
    // wrong upload can be undone. Best effort: a database without the history table still imports.
    try {
      const { snapshotSalesBeforeReplace } = await import("../bla-bli-blu-dashboard/bbb-uploads.service.js");
      await snapshotSalesBeforeReplace(processId, ids, batchId, importedByUserId);
    } catch (e) {
      console.warn("[bla-bli-blu-overall-sales] history snapshot skipped:", e instanceof Error ? e.message : e);
    }
  }

  const insertRows: ChunkInsertRow[] = toImport.map((a) => ({ rowId: a.rowId, rowNo: a.rowNo, values: recordValues(a.record, processId!, batchId, importedByUserId) }));
  const inserted = insertRows.length
    ? await chunkedMasmisInsert({
      insertPrefix: `INSERT INTO ${SALES}
           (id, process_id, order_id, report_date, week_label, emp_code, emp_name,
            customer_number, alternate_number, payment_status, amount, campaign,
            calling_status, discount_code, item_count, current_status, lineitem_sku,
            new_sold_line_item, new_sold_line_item_category, lead_line_item,
            source_channel, business_type, order_creation_time, call_date_time,
            call_duration_seconds, call_attempt_count, source_created_by,
            recording_link, data_source, source_reference, created_by)`,
      placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
      // Order ID is the business key: a re-uploaded order REPLACES the stored row with the latest values (Cancel ->
      // RTO -> Delivered stays one row). Every uploaded column is updated, and the row now belongs to this batch.
      insertSuffix: `ON DUPLICATE KEY UPDATE
            report_date = VALUES(report_date), week_label = VALUES(week_label), emp_code = VALUES(emp_code),
            emp_name = VALUES(emp_name), customer_number = VALUES(customer_number), alternate_number = VALUES(alternate_number),
            payment_status = VALUES(payment_status), amount = VALUES(amount), campaign = VALUES(campaign),
            calling_status = VALUES(calling_status), discount_code = VALUES(discount_code), item_count = VALUES(item_count),
            current_status = VALUES(current_status), lineitem_sku = VALUES(lineitem_sku), new_sold_line_item = VALUES(new_sold_line_item),
            new_sold_line_item_category = VALUES(new_sold_line_item_category), lead_line_item = VALUES(lead_line_item),
            source_channel = VALUES(source_channel), business_type = VALUES(business_type), order_creation_time = VALUES(order_creation_time),
            call_date_time = VALUES(call_date_time), call_duration_seconds = VALUES(call_duration_seconds),
            call_attempt_count = VALUES(call_attempt_count), source_created_by = VALUES(source_created_by),
            recording_link = VALUES(recording_link), source_reference = VALUES(source_reference)`,
      rows: insertRows,
    })
    : { importedRows: 0, errorUpdates: [] as Array<{ rowId: string; message: string }>, importedRowIds: [] as string[] };

  // A database failure on a row is a technical reject, kept apart from the file's own (business) problems.
  const rowNoOf = new Map(batchRows.map((r) => [r.id, r.row_no]));
  for (const u of inserted.errorUpdates) {
    issues.push({
      row: rowNoOf.get(u.rowId) ?? 0, field: "(row)", value: null, code: "DB_ERROR",
      reason: `The database refused this row: ${u.message.replace(/^Row \d+: /, "")}`.slice(0, 500),
      requiredFormat: null, category: "technical", severity: "reject",
    });
  }
  const failedIds = new Set(inserted.errorUpdates.map((e) => e.rowId));
  if (inserted.importedRows > 0) {
    await markRowsImported(toImport.filter((a) => !failedIds.has(a.rowId)).map((a) => a.rowId));
  }

  // Rejected rows: row_status 'error' with the readable sentence per problem (warnings stay on the reject log).
  const rejectsByRow = new Map<number, string[]>();
  for (const i of issues) {
    if (i.severity !== "reject") continue;
    rejectsByRow.set(i.row, [...(rejectsByRow.get(i.row) ?? []), rejectMessage(i)]);
  }
  const rowIdOf = new Map(batchRows.map((r) => [r.row_no, r.id]));
  const errorUpdates = [...rejectsByRow.entries()].map(([rowNo, messages]) => ({ rowId: rowIdOf.get(rowNo)!, messages })).filter((u) => u.rowId);
  for (let i = 0; i < errorUpdates.length; i += 1000) {
    const part = errorUpdates.slice(i, i + 1000);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${part.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ")} END
        WHERE id IN (${part.map(() => "?").join(",")})`,
      [...part.flatMap((u) => [u.rowId, JSON.stringify(u.messages)]), ...part.map((u) => u.rowId)],
    );
  }

  await saveRejects(batchId, batchRows.map((r) => r.row_no), issues, monthOfRow);
  if (processId) await saveDateCorrections(batchId, processId, plan);

  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;
  const warningRows = new Set(issues.filter((i) => i.severity === "warning" && !rejectsByRow.has(i.row)).map((i) => i.row)).size;
  const summary = {
    ...uploadSummary(batchRows.length, importedRows, errorRows),
    updatedOrders: plan.reduce((s, p) => s + p.updatedCount, 0),
    newOrders: plan.reduce((s, p) => s + p.insertedCount, 0),
    duplicateInFile: dupes.length,
    technicalRejects: new Set(issues.filter((i) => i.category === "technical").map((i) => i.row)).size,
    warningRows,
    months: [...new Set(toImport.map((a) => a.record.reportDate.slice(0, 7)))].sort(),
  };

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  const errorSummary = errorRows
    ? `${errorRows} of ${batchRows.length} row(s) rejected (${summary.successPct}% accepted). See the rejection log for row, field, value and reason.`
    : null;
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ?, error_summary = COALESCE(?, error_summary),
            metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()), '$.bbbSales', CAST(? AS JSON))
      WHERE id = ?`,
    [finalStatus, importedRows, errorRows, errorSummary, JSON.stringify(summary), batchId],
  );

  const errors = [...rejectsByRow.entries()].map(([rowNo, m]) => `Row ${rowNo}: ${m.join("; ")}`);
  return { importedRows, errorRows, errors, warningRows, summary };
}
