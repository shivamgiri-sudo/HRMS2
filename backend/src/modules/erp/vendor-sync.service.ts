import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { billQuery } from "../../db/billDb.js";

/**
 * Pulls vendors from db_bill.tbl_vendormaster that are absent from mas_hrms.vendor_master.
 *
 * The original migration stamped vendor_code as 'DB_BILL_<tbl_vendormaster.Id>', so presence
 * is checked by that key — no fuzzy name matching needed.
 *
 * Columns available in tbl_vendormaster: Id, vendor, TallyHead, state, pincode,
 * TDS (rate), TDSSection, TDSEnabled.
 * Not available: contact_name, contact_email, city, payment_terms, gst_number, pan_number.
 * Those land as NULL and can be filled in by Finance through the Vendor Master UI.
 *
 * TDSSection is free text (e.g. "TDS Contractor (194C)"). We store it as-is, truncated to 20
 * chars, which is safe because the enrichment update path already handles that format.
 */

interface BillVendorRow {
  Id: number;
  vendor: string | null;
  TallyHead: string | null;
  state: string | null;
  pincode: string | null;
  TDS: number | null;
  TDSSection: string | null;
  TDSEnabled: number | null;
}

const PLACEHOLDERS = new Set(["na", "n/a", "n.a.", "-", "--", "nil", "none", "null", ""]);
function blankToNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return PLACEHOLDERS.has(s.toLowerCase()) ? null : s || null;
}

function ratioToNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export async function syncVendorsFromDbBill(): Promise<{
  total: number;
  inserted: number;
  skipped: number;
}> {
  const billRows = await billQuery<BillVendorRow>(
    "SELECT Id, vendor, TallyHead, state, pincode, TDS, TDSSection, TDSEnabled FROM tbl_vendormaster"
  );

  if (billRows.length === 0) {
    return { total: 0, inserted: 0, skipped: 0 };
  }

  // Build the set of db_bill IDs already in mas_hrms so we can skip them quickly.
  const [existingRows] = await db.execute<RowDataPacket[]>(
    "SELECT vendor_code FROM vendor_master WHERE vendor_code LIKE 'DB_BILL_%'"
  );
  const existingCodes = new Set<string>(
    (existingRows as RowDataPacket[]).map((r) => String(r.vendor_code))
  );

  let inserted = 0;
  let skipped = 0;

  for (const row of billRows) {
    const vendorCode = `DB_BILL_${row.Id}`;

    if (existingCodes.has(vendorCode)) {
      skipped += 1;
      continue;
    }

    const vendorName = blankToNull(row.vendor);
    if (!vendorName) {
      // A vendor with no name cannot be created — skip and count as skipped.
      skipped += 1;
      continue;
    }

    const tallyName   = blankToNull(row.TallyHead);
    const state       = blankToNull(row.state);
    const pinCode     = blankToNull(row.pincode);
    const tdsRate     = ratioToNull(row.TDS);
    const tdsEnabled  = Number(row.TDSEnabled) === 1 ? 1 : 0;
    const rawSection  = blankToNull(row.TDSSection);
    // Truncate to 20 chars — the column is VARCHAR(20). The backfill script normalises
    // the free-text further; here we just store it so Finance can review and correct.
    const tdsSection  = rawSection ? rawSection.slice(0, 20) : null;

    await db.execute(
      `INSERT INTO vendor_master
         (id, vendor_code, vendor_name, vendor_type, tally_name, state, pin_code,
          tds_rate, tds_enabled, tds_section, is_active)
       VALUES (?, ?, ?, 'supplier', ?, ?, ?, ?, ?, ?, 1)`,
      [randomUUID(), vendorCode, vendorName, tallyName, state, pinCode, tdsRate, tdsEnabled, tdsSection]
    );

    inserted += 1;
  }

  return { total: billRows.length, inserted, skipped };
}
