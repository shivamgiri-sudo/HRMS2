/**
 * The one place that knows how `db_bill.salary_data` maps into HRMS payroll.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `salary_data` carries TWO parallel sets of earning columns and nothing in the
 * schema says which is which:
 *
 *   Basic, HRA, Conv, Bonus, Portfolio, MedicalAllowance,
 *   SpecialAllowance, OtherAllowance, Gross            -> FULL MONTHLY ENTITLEMENT
 *
 *   Basic1, HRA1, Conv1, Bonus1, Portfolio1, MedicalAllowance1,
 *   SpecialAllowance1, OtherAllowance1, Gross1         -> EARNED (pro-rated)
 *                                                          = entitlement * EarnedDays / WorkingDays
 *
 * `LTA` and `PLI` have no earned variant; they are paid as-is.
 *
 * Every importer written before 2026-08-29 took the ENTITLEMENT set. Verified over
 * all 129,696 salary_prep_line rows joined to db_bill on employee code + month
 * (100% matched): salary_prep_line.gross_salary equalled db_bill `Gross` on
 * 129,696 of 129,696 rows. That single mis-mapping is the whole of the
 * "net <> gross - deductions on 87% of lines" finding. It moved no money - the
 * net was right - but it made every stored gross and every payslip line item the
 * sticker price rather than what the employee earned.
 *
 * THE LEGACY IDENTITY, verified 1,371/1,371 on 2026-07 with zero failures:
 *
 *   NetSalary = Gross1
 *             + Incentive + ExtraDayIncentive + Arrear + PLI
 *             - ESIC - EPF - IncomeTax - AdvPaid - LoanDed - TotalDeduction
 *
 * `TotalDeduction` is NOT the total of all deductions. It is the roll-up of only
 * the non-statutory buckets (ProTaxDeduction, LeaveDeduction, OtherDeduction,
 * MobileDedcution, ShortCollection, AssetRecovery, Insurance, SHSH). Adding it on
 * top of those individual columns double-counts them. ProTaxDeduction is often ''
 * while the PT was still taken, inside TotalDeduction.
 *
 * Gross1 is exactly the sum of the eight earned components - checked across every
 * 2026-07 row, difference 0.00 - so the earned set is complete and self-consistent.
 */

export function num(v) {
  const x = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isNaN(x) ? 0 : x;
}

/** Entitlement column -> earned column. Absent means "no earned variant, pay as-is". */
export const EARNED_COLUMN = {
  Basic: "Basic1",
  HRA: "HRA1",
  Bonus: "Bonus1",
  Conv: "Conv1",
  Portfolio: "Portfolio1",
  MedicalAllowance: "MedicalAllowance1",
  SpecialAllowance: "SpecialAllowance1",
  OtherAllowance: "OtherAllowance1",
  Gross: "Gross1",
};

/**
 * component_code, component_name, component_type, db_bill column.
 *
 * component_type is enum('earning','deduction','employer_cost') on the live
 * column and the server runs STRICT_TRANS_TABLES, so a non-member value is a hard
 * error, not a coercion. Same for source: enum('snapshot','structure','statutory',
 * 'manual','system'). Imported rows are 'snapshot'.
 */
export const COMPONENT_MAP = [
  ["BASIC",         "Basic Salary",              "earning",       "Basic1"],
  ["HRA",           "House Rent Allowance",      "earning",       "HRA1"],
  ["BONUS",         "Bonus",                     "earning",       "Bonus1"],
  ["CONV",          "Conveyance Allowance",      "earning",       "Conv1"],
  // The legacy column is `Portfolio`, but the payslip db_bill actually issues
  // (SalarySlipMaster) prints it as "PersonalAllowance" — verified equal on
  // MAS54221 (3,238), MAS54639 (1,390), MAS54643 (1,345) for 2026-07. The
  // employee-facing name wins; the code stays PORTFOLIO so nothing has to migrate.
  ["PORTFOLIO",     "Personal Allowance",        "earning",       "Portfolio1"],
  ["MA",            "Medical Allowance",         "earning",       "MedicalAllowance1"],
  ["LTA",           "LTA",                       "earning",       "LTA"],
  ["SPECIAL",       "Special Allowance",         "earning",       "SpecialAllowance1"],
  ["OA",            "Other Allowance",           "earning",       "OtherAllowance1"],
  ["INCENTIVE",     "Incentive",                 "earning",       "Incentive"],
  ["EXTRA_DAY_INC", "Extra Day Incentive",       "earning",       "ExtraDayIncentive"],
  ["ARREAR",        "Arrear",                    "earning",       "Arrear"],
  ["PLI",           "PLI",                       "earning",       "PLI"],
  ["PF_EMP",        "PF Employee",               "deduction",     "EPF"],
  ["ESIC_EMP",      "ESIC Employee",             "deduction",     "ESIC"],
  ["PT",            "Professional Tax",          "deduction",     "ProTaxDeduction"],
  ["TDS",           "Income Tax (TDS)",          "deduction",     "IncomeTax"],
  ["ADV",           "Advance Recovery",          "deduction",     "AdvPaid"],
  ["LOAN",          "Loan Deduction",            "deduction",     "LoanDed"],
  ["LWP",           "LWP Deduction",             "deduction",     "LeaveDeduction"],
  ["MOBILE_DED",    "Mobile Deduction",          "deduction",     "MobileDedcution"],
  ["ASSET_REC",     "Asset Recovery",            "deduction",     "AssetRecovery"],
  ["INS",           "Insurance",                 "deduction",     "Insurance"],
  // Two heads no importer ever mapped. Their money was never lost — it sits
  // inside TotalDeduction, which the net already reflects — but 54,953 + 462
  // payslips could not tell the employee what the deduction was for.
  // `TotalDeduction = ProTax + Leave + Other + Mobile + ShortCollection +
  //  AssetRecovery + Insurance + SHSH` holds on all 137,278 db_bill rows, so
  // itemising these two double-counts nothing.
  ["SHSH",          "Stay Healthy Stay Happy",   "deduction",     "SHSH"],
  ["SHORT_COLL",    "Short & Access in A/C",     "deduction",     "ShortCollection"],
  ["OTHER_DED",     "Other Deduction",           "deduction",     "OtherDeduction"],
  ["PF_EMP_CO",     "PF Employer",               "employer_cost", "EPFCompany"],
  ["ESIC_EMP_CO",   "ESIC Employer",             "employer_cost", "ESICCompany"],
  ["ADMIN_CHG",     "EPF Admin Charges",         "employer_cost", "AdminChrg"],
];

/** The eight earned earning columns that sum to Gross1. */
export const EARNED_GROSS_PARTS = [
  "Basic1", "HRA1", "Bonus1", "Conv1",
  "Portfolio1", "MedicalAllowance1", "SpecialAllowance1", "OtherAllowance1",
];

/** Non-gross additions that sit on top of earned gross. */
export const ADDITION_COLUMNS = ["Incentive", "ExtraDayIncentive", "Arrear", "PLI"];

/**
 * Everything actually withheld. `TotalDeduction` already rolls up the
 * non-statutory buckets, so those are NOT added again here.
 */
export function totalDeductions(br) {
  return num(br.ESIC) + num(br.EPF) + num(br.IncomeTax)
       + num(br.AdvPaid) + num(br.LoanDed) + num(br.TotalDeduction);
}

/** Earned gross. Prefer the stored Gross1; fall back to the parts if it is blank. */
export function earnedGross(br) {
  const g1 = num(br.Gross1);
  if (g1 !== 0) return g1;
  return EARNED_GROSS_PARTS.reduce((s, c) => s + num(br[c]), 0);
}

export function additions(br) {
  return ADDITION_COLUMNS.reduce((s, c) => s + num(br[c]), 0);
}

/** What the legacy register says was paid, recomputed from its own parts. */
export function derivedNet(br) {
  return earnedGross(br) + additions(br) - totalDeductions(br);
}

/** Every column any of the above reads - use this to build the SELECT. */
export const REQUIRED_COLUMNS = [
  "EmpCode", "SalDate", "WorkingDays", "ActualDays", "EarnedDays", "`Leave`",
  "Gross", "Gross1", ...EARNED_GROSS_PARTS, "LTA",
  ...ADDITION_COLUMNS,
  "EPF", "ESIC", "ProTaxDeduction", "IncomeTax", "AdvPaid", "LoanDed",
  "LeaveDeduction", "MobileDedcution", "ShortCollection", "AssetRecovery",
  "Insurance", "OtherDeduction", "SHSH", "TotalDeduction",
  "EPFCompany", "ESICCompany", "AdminChrg", "NetSalary",
];

/**
 * The non-statutory buckets `TotalDeduction` rolls up. Verified exact on all
 * 137,278 db_bill rows:
 *   TotalDeduction = ProTaxDeduction + LeaveDeduction + OtherDeduction
 *                  + MobileDedcution + ShortCollection + AssetRecovery
 *                  + Insurance + SHSH
 * Itemising these individually therefore reconciles to TotalDeduction exactly.
 */
export const TOTAL_DEDUCTION_PARTS = [
  "ProTaxDeduction", "LeaveDeduction", "OtherDeduction", "MobileDedcution",
  "ShortCollection", "AssetRecovery", "Insurance", "SHSH",
];
