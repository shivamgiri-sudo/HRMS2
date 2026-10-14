// backend/src/modules/client-billing/client-billing-party.ts
/**
 * One resolver for who the invoice is to and the GST facts printed on it, shared by the
 * proforma entry / approval screens (billing-header route) and the PDF, so they can never
 * disagree (owner feedback 2026-10-14: "GST, address — many informations not populated,
 * missing and incorrect").
 *
 * Rules:
 *  - Client state code comes from the client GSTIN (its first two digits are the state code by
 *    statute); the typed vendor_state_code is used only when there is no valid GSTIN.
 *  - State name and Place of Supply come from that code (GST_STATE_NAMES), the typed
 *    vendor_gst_state only when the code is unknown — the same source the tax type uses.
 *  - Our GSTIN is the cost centre's service_tax_no, else the branch GSTIN (what Tally uses).
 *  - Address lines get the city / PIN columns appended when they are not already in the text.
 *  - Anything missing or contradictory is listed in `warnings` for the screens to show.
 */
import { GST_STATE_NAMES, normaliseStateCode, stateCodeFromGstin } from "./client-billing-tax.js";

/** Columns the resolver needs; `cc` = cost_centre_master, `b` = branch_master. */
export const BILLING_PARTY_SQL = `
  cc.cost_centre_code, cc.company_name, cc.billing_client_name, cc.client_name,
  cc.service_tax_no, cc.vendor_gst_no, cc.vendor_gst_state, cc.vendor_state_code, cc.gst_type,
  cc.hsn_code, cc.sac_code,
  cc.bill_to_address1, cc.bill_to_address2, cc.bill_to_address3, cc.bill_to_address4, cc.bill_to_address5,
  cc.bill_to_city, cc.bill_to_pincode,
  cc.ship_to_address1, cc.ship_to_address2, cc.ship_to_address3, cc.ship_to_address4, cc.ship_to_address5,
  cc.ship_to_city, cc.ship_to_pincode,
  b.branch_name, b.gst_state_code AS branch_state_code, b.gstin AS branch_gstin`;

export interface BillingParty {
  clientName: string;
  billTo: string[];
  shipTo: string[];
  clientGstin: string;
  clientStateCode: string;
  clientStateName: string;
  placeOfSupply: string;
  ourGstin: string;
  pan: string;
  hsnCode: string;
  sacCode: string;
  warnings: string[];
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v).trim());

/** A GSTIN's characters 3-12 are the PAN by statutory format. */
export function panFromGstin(gstin: string): string {
  return stateCodeFromGstin(gstin) ? gstin.trim().toUpperCase().slice(2, 12) : "";
}

/** Five typed lines, plus "City - PIN" when neither is already written into them. */
export function addressWithCity(lines: unknown[], city: unknown, pin: unknown): string[] {
  const out = lines.map(str).filter(Boolean);
  if (!out.length) return out;
  const text = out.join(" ").toLowerCase();
  const c = str(city);
  const p = str(pin).replace(/\s+/g, "");
  const missingCity = c && !text.includes(c.toLowerCase()) ? c : "";
  const missingPin = p && !text.replace(/\s+/g, "").includes(p) ? p : "";
  const extra = [missingCity, missingPin].filter(Boolean).join(" - ");
  if (extra) out.push(extra);
  return out;
}

export function resolveBillingParty(r: Row): BillingParty {
  const warnings: string[] = [];
  const clientGstin = str(r.vendor_gst_no).toUpperCase();
  const fromGstin = stateCodeFromGstin(clientGstin);
  const typedCode = normaliseStateCode(str(r.vendor_state_code));
  if (clientGstin && !fromGstin) warnings.push(`Client GSTIN "${clientGstin}" is not a valid GSTIN.`);
  if (!clientGstin) warnings.push("Client GSTIN is not recorded on the cost centre.");
  if (fromGstin && typedCode && typedCode !== fromGstin) {
    warnings.push(`Cost centre state code ${typedCode} does not match the client GSTIN (${fromGstin}); the GSTIN is used.`);
  }
  const clientStateCode = fromGstin ?? typedCode ?? "";
  const clientStateName = (clientStateCode && GST_STATE_NAMES[clientStateCode]) || str(r.vendor_gst_state).toUpperCase();
  if (!clientStateName) warnings.push("Client GST state is unknown (no GSTIN and no state code).");
  const typedName = str(r.vendor_gst_state).toUpperCase();
  if (typedName && clientStateName && typedName !== clientStateName && GST_STATE_NAMES[clientStateCode]) {
    warnings.push(`Cost centre GST state "${str(r.vendor_gst_state)}" differs from the GSTIN state ${clientStateName}; the GSTIN state is used.`);
  }

  const ourGstin = (str(r.service_tax_no) || str(r.branch_gstin)).toUpperCase();
  if (!ourGstin) warnings.push("Our GSTIN is missing (cost centre GST No. and branch GSTIN are blank).");
  const ourCode = stateCodeFromGstin(ourGstin);
  const branchCode = normaliseStateCode(str(r.branch_state_code));
  if (ourGstin && !ourCode) warnings.push(`Our GSTIN "${ourGstin}" is not a valid GSTIN.`);
  if (ourCode && branchCode && ourCode !== branchCode) {
    warnings.push(`Our GSTIN state (${ourCode}) differs from the branch GST state (${branchCode}).`);
  }

  const billTo = addressWithCity([r.bill_to_address1, r.bill_to_address2, r.bill_to_address3, r.bill_to_address4, r.bill_to_address5], r.bill_to_city, r.bill_to_pincode);
  const shipOwn = addressWithCity([r.ship_to_address1, r.ship_to_address2, r.ship_to_address3, r.ship_to_address4, r.ship_to_address5], r.ship_to_city, r.ship_to_pincode);
  if (!billTo.length) warnings.push("Bill To address is blank on the cost centre.");
  const sacCode = str(r.sac_code);
  if (!sacCode && !str(r.hsn_code)) warnings.push("SAC / HSN code is blank on the cost centre.");

  return {
    // company_name is OUR company; it is only the last resort for the client's name.
    clientName: str(r.billing_client_name) || str(r.client_name) || str(r.company_name),
    billTo,
    shipTo: shipOwn.length ? shipOwn : billTo,
    clientGstin,
    clientStateCode,
    clientStateName,
    placeOfSupply: clientStateName ? `${clientStateName}${clientStateCode ? ` (${clientStateCode})` : ""}` : "",
    ourGstin,
    pan: panFromGstin(ourGstin),
    hsnCode: str(r.hsn_code),
    sacCode,
    warnings,
  };
}
