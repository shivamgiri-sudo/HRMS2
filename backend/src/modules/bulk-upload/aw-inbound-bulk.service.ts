import { insertAwInboundRows } from "../sales-upload/sales-upload.service.js";
import { importViaSharedInsert } from "./bridge-insert-helper.js";

/**
 * Appreciate Health's "AW Inbound" CDR export -- writes into the SAME
 * already-live db_masmis.aw_inbound table the separate My Dashboards tool
 * already uses.
 *
 * Delegates to sales-upload.service.ts's insertAwInboundRows -- the same
 * function the older, already-working sales-upload buffer-upload flow uses
 * for this exact table -- so there is exactly one writer, reachable from
 * both places.
 */
export async function importAwInboundBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  return importViaSharedInsert(batchId, insertAwInboundRows, importedByUserId, "callId");
}
