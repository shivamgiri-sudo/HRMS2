import { insertAwNewCdrRows } from "../sales-upload/sales-upload.service.js";
import { importViaSharedInsert } from "./bridge-insert-helper.js";

/**
 * Appreciate Health's "AW New CDR" outbound CDR export -- writes into the
 * SAME already-live db_masmis.aw_new_cdr table the separate My Dashboards
 * tool already uses.
 *
 * Delegates to sales-upload.service.ts's insertAwNewCdrRows -- the same
 * function the older, already-working sales-upload buffer-upload flow uses
 * for this exact table -- so there is exactly one writer, reachable from
 * both places.
 */
export async function importAwNewCdrBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  return importViaSharedInsert(batchId, insertAwNewCdrRows, importedByUserId, "callId");
}
