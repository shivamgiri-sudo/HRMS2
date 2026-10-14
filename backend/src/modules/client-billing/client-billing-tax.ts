/**
 * Pure tax/rounding helpers for the client-billing module (no DB access).
 *
 * Single rounding rule: every amount is held as integer PAISE, and each money figure is
 * rounded half-up to 2 dp exactly once —
 *   - a line amount  = round(qty * rate)   (deduction lines count negative)
 *   - taxable value  = SUM of the rounded line amounts (never re-rounded)
 *   - GST            = round(taxable * 18%) as IGST, or round(taxable * 9%) each for CGST / SGST
 *   - grand total    = taxable + taxes (a sum of already-rounded figures)
 * Working in paise avoids float artefacts such as 1.005 * 100 = 100.49999999999999.
 *
 * GST type is derived from the supplier state versus the place of supply (the recipient's
 * state, taken from the first two digits of the client GSTIN) — not from the
 * `cost_centre_master.gst_type` flag, which can go stale. The flag is only the fallback
 * when a state cannot be determined from either side.
 */

export type GstType = "Integrated" | "Intrastate";

/** GST state codes (first two digits of a GSTIN) -> state / UT name. */
export const GST_STATE_NAMES: Record<string, string> = {
  "01": "JAMMU AND KASHMIR",
  "02": "HIMACHAL PRADESH",
  "03": "PUNJAB",
  "04": "CHANDIGARH",
  "05": "UTTARAKHAND",
  "06": "HARYANA",
  "07": "DELHI",
  "08": "RAJASTHAN",
  "09": "UTTAR PRADESH",
  "10": "BIHAR",
  "11": "SIKKIM",
  "12": "ARUNACHAL PRADESH",
  "13": "NAGALAND",
  "14": "MANIPUR",
  "15": "MIZORAM",
  "16": "TRIPURA",
  "17": "MEGHALAYA",
  "18": "ASSAM",
  "19": "WEST BENGAL",
  "20": "JHARKHAND",
  "21": "ODISHA",
  "22": "CHHATTISGARH",
  "23": "MADHYA PRADESH",
  "24": "GUJARAT",
  "26": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
  "27": "MAHARASHTRA",
  "29": "KARNATAKA",
  "30": "GOA",
  "31": "LAKSHADWEEP",
  "32": "KERALA",
  "33": "TAMIL NADU",
  "34": "PUDUCHERRY",
  "35": "ANDAMAN AND NICOBAR ISLANDS",
  "36": "TELANGANA",
  "37": "ANDHRA PRADESH",
  "38": "LADAKH",
  "97": "OTHER TERRITORY",
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** Two-digit state code of a well-formed GSTIN, else null. */
export function stateCodeFromGstin(
  gstin: string | null | undefined,
): string | null {
  const s = String(gstin ?? "")
    .trim()
    .toUpperCase();
  return GSTIN_RE.test(s) ? s.slice(0, 2) : null;
}

/** Normalises "9", "09", " 09 " to "09"; anything else to null. */
export function normaliseStateCode(
  code: string | null | undefined,
): string | null {
  const s = String(code ?? "").trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  return s.padStart(2, "0");
}

export interface GstTypeInputs {
  supplierGstin?: string | null;
  supplierStateCode?: string | null; // branch_master.gst_state_code
  clientGstin?: string | null;
  clientStateCode?: string | null; // cost_centre_master.vendor_state_code
  fallbackFlag?: string | null; // cost_centre_master.gst_type
}

export interface DerivedGstType {
  gstType: GstType | null;
  supplierState: string | null;
  placeOfSupplyState: string | null;
  /** true when derived from the two states; false when only the stored flag was usable. */
  derived: boolean;
}

/**
 * Place of supply for services = the recipient's state. The GSTIN prefix is authoritative
 * (the separate state-code column is free text in legacy data and disagrees with the
 * GSTIN on live rows), so it wins; the column is the fallback.
 */
export function deriveGstType(input: GstTypeInputs): DerivedGstType {
  const supplierState =
    stateCodeFromGstin(input.supplierGstin) ??
    normaliseStateCode(input.supplierStateCode);
  const placeOfSupplyState =
    stateCodeFromGstin(input.clientGstin) ??
    normaliseStateCode(input.clientStateCode);
  if (supplierState && placeOfSupplyState) {
    return {
      gstType:
        supplierState === placeOfSupplyState ? "Intrastate" : "Integrated",
      supplierState,
      placeOfSupplyState,
      derived: true,
    };
  }
  const flag = input.fallbackFlag;
  return {
    gstType: flag === "Integrated" || flag === "Intrastate" ? flag : null,
    supplierState,
    placeOfSupplyState,
    derived: false,
  };
}

/** Round-half-up to whole paise, robust to binary-float representation error. */
export function toPaise(amount: number): number {
  const scaled = Number((Math.abs(amount) * 100).toPrecision(15));
  const rounded = Math.floor(scaled + 0.5);
  return amount < 0 ? -rounded : rounded;
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

/** Rounds a rupee amount to 2 dp using the module's single rounding rule. */
export function round2(amount: number): number {
  return fromPaise(toPaise(amount));
}

export interface AmountLine {
  qty: number;
  rate: number;
  lineType?: "charge" | "deduction";
}

export interface ComputedAmounts {
  /** Per input line, the rounded positive line amount (sign is applied by lineType). */
  lineAmounts: number[];
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
}

export function computeInvoiceAmounts(
  lines: AmountLine[],
  gstType: GstType,
  applyGst: boolean,
): ComputedAmounts {
  const linePaise = lines.map((l) => toPaise(l.qty * l.rate));
  const taxablePaise = lines.reduce(
    (sum, l, i) =>
      l.lineType === "deduction" ? sum - linePaise[i] : sum + linePaise[i],
    0,
  );
  let igst = 0;
  let cgst = 0;
  let sgst = 0;
  // Tax is rounded to the WHOLE RUPEE, half up, per component — exactly what I-Spark stores and
  // prints (live db_bill: 44,840 x 18% = 8,071.20 -> igst 8071, grnd 52911; 1,20,380 x 9% =
  // 10,834.20 -> cgst 10834 and sgst 10834). Integer arithmetic on paise, so no float drift:
  // rupees = round(taxablePaise * pct / 10000).
  const wholeRupeeTax = (pct: number) => Math.round((taxablePaise * pct) / 10000) * 100;
  if (applyGst) {
    if (gstType === "Integrated") {
      igst = wholeRupeeTax(18);
    } else {
      cgst = wholeRupeeTax(9);
      sgst = cgst;
    }
  }
  return {
    lineAmounts: linePaise.map(fromPaise),
    totalAmount: fromPaise(taxablePaise),
    igstAmount: fromPaise(igst),
    cgstAmount: fromPaise(cgst),
    sgstAmount: fromPaise(sgst),
    grandTotal: fromPaise(taxablePaise + igst + cgst + sgst),
  };
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/**
 * `financeYear` is part of the bill-number scope key, so a stray "2026-2027" or "26-27"
 * would open a fresh counter and re-issue numbers. Accept only YYYY-YY where YY is the
 * following year.
 */
export function assertFinanceYear(financeYear: string): void {
  const m = /^(\d{4})-(\d{2})$/.exec(String(financeYear ?? ""));
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) {
    throw badRequest(
      `financeYear must look like 2026-27 (got "${String(financeYear ?? "")}")`,
    );
  }
}

/** Month label must be `Mmm-YY` and belong to the finance year (Apr..Dec = start year, Jan..Mar = next). */
export function assertMonthLabelInFinanceYear(
  monthLabel: string,
  financeYear: string,
): void {
  assertFinanceYear(financeYear);
  const m = /^([A-Z][a-z]{2})-(\d{2})$/.exec(String(monthLabel ?? ""));
  const monthIndex = m ? MONTH_ABBR.indexOf(m[1]) : -1;
  if (!m || monthIndex < 0) {
    throw badRequest(
      `monthLabel must look like Aug-26 (got "${String(monthLabel ?? "")}")`,
    );
  }
  const startYear = Number(financeYear.slice(0, 4));
  const expectedYear = monthIndex >= 3 ? startYear : startYear + 1;
  if (Number(m[2]) !== expectedYear % 100) {
    throw badRequest(
      `monthLabel ${monthLabel} is outside finance year ${financeYear}`,
    );
  }
}
