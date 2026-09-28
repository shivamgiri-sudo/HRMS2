import { insertAwMandateRows } from "../sales-upload/sales-upload.service.js";
import { importViaSharedInsert } from "./bridge-insert-helper.js";

/**
 * Appreciate Health's "AW Mandate" billing-type mandate headcount export --
 * writes into the SAME already-live db_masmis.aw_mandate table the separate
 * My Dashboards tool already uses.
 *
 * Delegates to sales-upload.service.ts's insertAwMandateRows -- the same
 * function the older, already-working sales-upload buffer-upload flow uses
 * for this exact table -- so there is exactly one writer, reachable from
 * both places.
 */
export async function importAwMandateBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  return importViaSharedInsert(batchId, insertAwMandateRows, importedByUserId, "billingType");
}
