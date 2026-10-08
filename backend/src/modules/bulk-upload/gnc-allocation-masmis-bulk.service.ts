import { insertGncAllocationRows } from "../sales-upload/sales-upload.service.js";
import { importViaSharedInsert } from "./bridge-insert-helper.js";

/** Excel serial or plain text date -> "YYYY-MM-DD". Kept here (unused by the bridged insert
 * path, which delegates its own date parsing to sales-upload.service.ts) only because this
 * module's own coercion test still imports and exercises it directly. */
export function parseGncAllocationDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "0" || v === "-") return null;
  const sn = parseFloat(v);
  if (Number.isFinite(sn) && sn > 40000 && sn < 60000) {
    const d = new Date((sn - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? m[0] : null;
}

/**
 * GNC's real "Allocation" export -- writes into the SAME already-live
 * db_masmis.gnc_allocation table (60,375 real rows) the separate My
 * Dashboards tool already uses.
 *
 * Delegates the actual row-insert logic to sales-upload.service.ts's
 * insertGncAllocationRows -- the same function the older, already-working
 * sales-upload buffer-upload flow uses for this exact table. Two independent
 * writers to gnc_allocation risked duplicate rows and column-mapping drift
 * between them; there is now exactly one, reachable from both places.
 */
export async function importGncAllocationMasmisBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  return importViaSharedInsert(batchId, insertGncAllocationRows, importedByUserId, "uid");
}
