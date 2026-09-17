import { insertNeemansAprRows } from "../sales-upload/sales-upload.service.js";
import { importViaSharedInsert } from "./bridge-insert-helper.js";

/**
 * Neemans' real APR export -- writes into the SAME already-live
 * db_masmis.neemans_apr table (132 real rows) the separate My Dashboards
 * tool already uses.
 *
 * Delegates to sales-upload.service.ts's insertNeemansAprRows -- the same
 * function the older, already-working sales-upload buffer-upload flow uses
 * for this exact table -- so there is exactly one writer, reachable from
 * both places.
 */
export async function importNeemansAprMasmisBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  return importViaSharedInsert(batchId, insertNeemansAprRows, importedByUserId, "empName");
}
