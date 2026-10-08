import type { RowDataPacket } from "mysql2";
import { gstinStateCode, isValidGstin } from "../gst/gst-export.service.js";

/**
 * When a GRN is submitted with a valid GSTIN for a vendor that has none on file, remember it on the
 * vendor so the next GRN fills it in automatically.
 *
 * WHY: 306 of 1,533 active vendors had no GSTIN in the vendor master, so the GRN form had nothing to
 * fill in after the vendor was picked. Only a GSTIN that passes the statutory check digit, and agrees
 * with the vendor's PAN when one is on file, is saved - a typo must not become the vendor's GSTIN.
 * A GSTIN already on file is never overwritten.
 */

type Executor = { execute(sql: string, params?: any[]): Promise<[any, any]> };

const PLACEHOLDERS = new Set(["", "NA", "N/A", "NIL", "-", "NONE"]);

export type GstinCaptureDecision =
  | { save: true; gstin: string; stateCode: string | null }
  | {
      save: false;
      reason: "no_gstin" | "invalid" | "vendor_has_gstin" | "pan_mismatch";
    };

export function decideGstinCapture(input: {
  grnGstin: string | null | undefined;
  vendorGstin: string | null | undefined;
  vendorPan: string | null | undefined;
}): GstinCaptureDecision {
  const grn = String(input.grnGstin ?? "")
    .trim()
    .toUpperCase();
  if (PLACEHOLDERS.has(grn)) return { save: false, reason: "no_gstin" };
  if (!isValidGstin(grn)) return { save: false, reason: "invalid" };

  const onFile = String(input.vendorGstin ?? "")
    .trim()
    .toUpperCase();
  if (!PLACEHOLDERS.has(onFile))
    return { save: false, reason: "vendor_has_gstin" };

  const pan = String(input.vendorPan ?? "")
    .trim()
    .toUpperCase();
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) && grn.slice(2, 12) !== pan) {
    return { save: false, reason: "pan_mismatch" };
  }
  return { save: true, gstin: grn, stateCode: gstinStateCode(grn) };
}

export async function captureVendorGstin(
  executor: Executor,
  input: {
    vendorId: string | null | undefined;
    grnGstin: string | null | undefined;
  },
): Promise<GstinCaptureDecision> {
  if (!input.vendorId) return { save: false, reason: "no_gstin" };
  const [rows] = (await executor.execute(
    `SELECT gst_number, pan_number FROM vendor_master WHERE id = ? LIMIT 1`,
    [input.vendorId],
  )) as [RowDataPacket[], unknown];
  if (!rows[0]) return { save: false, reason: "no_gstin" };
  const decision = decideGstinCapture({
    grnGstin: input.grnGstin,
    vendorGstin: rows[0].gst_number,
    vendorPan: rows[0].pan_number,
  });
  if (!decision.save) return decision;
  // The WHERE repeats the "no GSTIN on file" test so two GRNs submitted at once cannot overwrite each other.
  await executor.execute(
    `UPDATE vendor_master
        SET gst_number = ?, gst_state_code = COALESCE(NULLIF(gst_state_code, ''), ?)
      WHERE id = ?
        AND (gst_number IS NULL OR TRIM(gst_number) = '' OR UPPER(TRIM(gst_number)) IN ('NA','N/A','NIL','-','NONE'))`,
    [decision.gstin, decision.stateCode, input.vendorId],
  );
  return decision;
}
