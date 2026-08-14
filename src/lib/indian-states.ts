/**
 * GST state codes for India — used for vendor GRN forms and anywhere
 * IGST vs CGST/SGST derivation is needed.
 */
export const GST_STATE_CODES = [
  { value: "01", label: "01 - Jammu & Kashmir" },
  { value: "02", label: "02 - Himachal Pradesh" },
  { value: "03", label: "03 - Punjab" },
  { value: "04", label: "04 - Chandigarh" },
  { value: "05", label: "05 - Uttarakhand" },
  { value: "06", label: "06 - Haryana" },
  { value: "07", label: "07 - Delhi" },
  { value: "08", label: "08 - Rajasthan" },
  { value: "09", label: "09 - Uttar Pradesh" },
  { value: "10", label: "10 - Bihar" },
  { value: "11", label: "11 - Sikkim" },
  { value: "12", label: "12 - Arunachal Pradesh" },
  { value: "13", label: "13 - Nagaland" },
  { value: "14", label: "14 - Manipur" },
  { value: "15", label: "15 - Mizoram" },
  { value: "16", label: "16 - Tripura" },
  { value: "17", label: "17 - Meghalaya" },
  { value: "18", label: "18 - Assam" },
  { value: "19", label: "19 - West Bengal" },
  { value: "20", label: "20 - Jharkhand" },
  { value: "21", label: "21 - Odisha" },
  { value: "22", label: "22 - Chhattisgarh" },
  { value: "23", label: "23 - Madhya Pradesh" },
  { value: "24", label: "24 - Gujarat" },
  { value: "26", label: "26 - Dadra & Nagar Haveli and Daman & Diu" },
  { value: "27", label: "27 - Maharashtra" },
  { value: "29", label: "29 - Karnataka" },
  { value: "30", label: "30 - Goa" },
  { value: "31", label: "31 - Lakshadweep" },
  { value: "32", label: "32 - Kerala" },
  { value: "33", label: "33 - Tamil Nadu" },
  { value: "34", label: "34 - Puducherry" },
  { value: "35", label: "35 - Andaman & Nicobar" },
  { value: "36", label: "36 - Telangana" },
  { value: "37", label: "37 - Andhra Pradesh" },
  { value: "38", label: "38 - Ladakh" },
] as const;

export type GstStateCode = typeof GST_STATE_CODES[number]["value"];

/**
 * Derives GST type from vendor and billing state codes.
 * - Same state → CGST/SGST (intra-state)
 * - Different states → IGST (inter-state)
 * - Either missing → defaults to none
 */
export function deriveGstType(
  vendorStateCode: string | null | undefined,
  billingStateCode: string | null | undefined
): "cgst_sgst" | "igst" | "none" {
  if (!vendorStateCode || !billingStateCode) return "none";
  return vendorStateCode === billingStateCode ? "cgst_sgst" : "igst";
}

/**
 * Extracts state code from a 15-character GSTIN.
 * First 2 digits are the state code.
 */
export function extractStateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  const stateCode = gstin.slice(0, 2);
  // Validate it's a known state code
  if (GST_STATE_CODES.some((s) => s.value === stateCode)) {
    return stateCode;
  }
  return null;
}
