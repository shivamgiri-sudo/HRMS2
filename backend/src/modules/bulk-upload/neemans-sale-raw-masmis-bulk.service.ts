import { insertNeemansSaleRawRows } from "../sales-upload/sales-upload.service.js";
import { importViaSharedInsert } from "./bridge-insert-helper.js";

export const NEEMANS_SALE_RAW_HEADERS = [
  "week", "date", "empId", "name", "tl", "lob", "tenure", "orderId", "customerNumber",
  "emailId", "paymentStatus", "amount", "discountCode", "lineItemName", "callingLob",
  "callingStatus", "status", "count", "neemansOrderId", "currentStatus", "finalStatus",
  "lineItemQty", "target", "callDateTime", "duration", "createdAt",
] as const;

/**
 * Neemans' real "Sale Raw" export -- writes into the SAME already-live
 * db_masmis.neemans_sale_raw table (3,800 real rows) the separate My
 * Dashboards tool already uses. That table's "date"/call_date_time/
 * duration/created_at_raw columns store the RAW, unconverted Excel serial
 * text on purpose (confirmed via a real live row) -- insertNeemansSaleRawRows
 * preserves that convention, which is another reason to delegate to it
 * rather than re-deriving the same mapping here.
 *
 * Delegates to sales-upload.service.ts's insertNeemansSaleRawRows -- the
 * same function the older, already-working sales-upload buffer-upload flow
 * uses for this exact table -- so there is exactly one writer, reachable
 * from both places.
 */
export async function importNeemansSaleRawMasmisBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  return importViaSharedInsert(batchId, insertNeemansSaleRawRows, importedByUserId, "orderId");
}
