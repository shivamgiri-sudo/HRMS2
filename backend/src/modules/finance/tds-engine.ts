/**
 * TDS on vendor payments - the pure rules, no database.
 *
 * WHY: the only TDS logic in the system was one flat rate typed on each vendor, applied to the
 * amount paid including GST, with the switch off for 1,730 of 1,832 vendors. In the six months to
 * September 2026 that produced Rs 0 of TDS on Rs 5.19 crore of payments, including Rs 1.18 crore
 * of office rent to vendors with the switch off.
 *
 * This module answers "what should have been deducted on this payment" from the section, the
 * deductee type taken from the PAN, the amount before GST and the vendor's payments so far in the
 * financial year. It is used in ADVISORY mode (it records what it would deduct next to what was
 * deducted); it does not change any payment.
 *
 * Section codes and limits follow the Income Tax Department's TDS tables (Income-tax Act, 2025,
 * section 393; the 194-series labels are kept because every form and vendor still uses them).
 * The figures live in tds_section_master so a rate change is a data change, not a deploy.
 */

export type TdsSection = {
  sectionCode: string;
  rateIndividual: number;
  rateOther: number;
  rateNoPan: number;
  /** Deduct when a single payment's base exceeds this (194C). */
  singleLimit: number | null;
  /** Deduct once the year's total base for this vendor and section exceeds this. */
  annualLimit: number | null;
};

export type DeducteeType = "individual" | "other" | "unknown";

export type TdsInput = {
  section: TdsSection | null;
  pan: string | null;
  /** This payment's amount BEFORE GST (pro-rata share when the bill is part-paid). */
  baseAmount: number;
  /** Amount before GST already paid to this vendor under this section in the same financial year. */
  ytdBase: number;
};

export type TdsResult = {
  applicable: boolean;
  rate: number;
  /** The amount the rate is applied to (may include a catch-up of earlier payments in the year). */
  deductionBase: number;
  expectedTds: number;
  reason: string;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** The 4th letter of a PAN says who holds it: P person, H HUF; C company, F firm, T trust and so on. */
export function deducteeTypeFromPan(
  pan: string | null | undefined,
): DeducteeType {
  const clean = String(pan ?? "")
    .trim()
    .toUpperCase();
  if (!PAN_PATTERN.test(clean)) return "unknown";
  return clean[3] === "P" || clean[3] === "H" ? "individual" : "other";
}

export function hasValidPan(pan: string | null | undefined): boolean {
  return PAN_PATTERN.test(
    String(pan ?? "")
      .trim()
      .toUpperCase(),
  );
}

/** Indian financial year of a date, e.g. 2026-10-06 -> "2026-27". */
export function financialYearOf(date: Date | string): string {
  const d =
    typeof date === "string"
      ? new Date(`${date.slice(0, 10)}T00:00:00Z`)
      : date;
  const year = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function computeExpectedTds(input: TdsInput): TdsResult {
  const { section, pan } = input;
  const base = round2(Math.max(0, input.baseAmount));
  const ytd = round2(Math.max(0, input.ytdBase));
  if (!section) {
    return {
      applicable: false,
      rate: 0,
      deductionBase: 0,
      expectedTds: 0,
      reason: "No TDS section applies to this head and sub-head.",
    };
  }
  if (base <= 0) {
    return {
      applicable: false,
      rate: 0,
      deductionBase: 0,
      expectedTds: 0,
      reason: "Nothing before GST to deduct on.",
    };
  }

  const type = deducteeTypeFromPan(pan);
  const panOk = type !== "unknown";
  const normalRate =
    type === "individual" ? section.rateIndividual : section.rateOther;
  // Section 206AA: no valid PAN means the higher of the normal rate and the no-PAN rate.
  const rate = panOk ? normalRate : Math.max(normalRate, section.rateNoPan);

  const overSingle = section.singleLimit != null && base > section.singleLimit;
  const total = round2(ytd + base);
  const overAnnual = section.annualLimit != null && total > section.annualLimit;
  const noLimit = section.singleLimit == null && section.annualLimit == null;

  if (!noLimit && !overSingle && !overAnnual) {
    return {
      applicable: false,
      rate,
      deductionBase: 0,
      expectedTds: 0,
      reason: `Below the limit for ${section.sectionCode} (this payment ${base.toFixed(2)}, year so far ${ytd.toFixed(2)}).`,
    };
  }

  // The payment that first takes the year's total over the annual limit carries the earlier ones too:
  // the limit decides WHETHER to deduct, the rate then applies to everything paid.
  const crossesNow =
    overAnnual &&
    section.annualLimit != null &&
    ytd <= section.annualLimit &&
    !overSingle;
  const deductionBase = crossesNow ? total : base;
  const expectedTds = round2((deductionBase * rate) / 100);
  const why = crossesNow
    ? `The year's total for this vendor has crossed ${section.annualLimit?.toFixed(0)}, so ${section.sectionCode} applies to all ${deductionBase.toFixed(2)} paid so far.`
    : `${section.sectionCode} at ${rate}% on ${deductionBase.toFixed(2)} before GST.`;
  return {
    applicable: true,
    rate,
    deductionBase,
    expectedTds,
    reason: panOk
      ? why
      : `${why} No valid PAN on the vendor, so the higher no-PAN rate applies.`,
  };
}
