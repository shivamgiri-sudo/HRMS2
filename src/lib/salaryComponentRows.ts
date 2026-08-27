/**
 * "Show every salary component that carries money" — one list, every screen.
 *
 * The same package was rendered by four screens (Salary Review queue drawer, its detail
 * page, the package preview, Approval Status) and each kept its own hand-written list of
 * rows. They disagreed: bonus appeared on one, admin charges on none, DA and gratuity
 * nowhere — so a reviewer could see a Gross the rows above it did not add up to. Two live
 * examples: a package with basic ₹8,000 shows gross ₹15,059, which is only explicable once
 * the ₹666 bonus is on screen; and the offer table's ₹1,600 conveyance / ₹200 PT rows had
 * no home at all on the offered-salary card.
 *
 * Field names differ by source — ats_employment_offer says pf_employer, the package master
 * says epf_employer, salary_component_assignments says employer_pf — so every row resolves
 * through an alias list rather than one column name.
 *
 * A component is shown when it carries a non-zero amount. The three core earnings
 * (Basic / HRA / Conveyance) always show, because their absence is itself information on a
 * screen whose job is to prove the package is complete.
 */

export interface ComponentRow { label: string; value: number }

/**
 * Any row that carries salary component columns — the offer, the package master, the
 * assignment. Deliberately an index signature over `object` rather than
 * Record<string, unknown>, so a caller can pass a typed interface (AdminPackage,
 * ExistingPkg) without casting: TS does not treat an interface as assignable to
 * Record<string, unknown>, only a type alias.
 */
type Source = { [key: string]: unknown } | object | null | undefined;

/** First alias that holds a usable number. MySQL DECIMALs arrive as strings. */
function pick(src: Source, aliases: string[]): number {
  if (!src) return 0;
  const row = src as Record<string, unknown>;
  for (const key of aliases) {
    const raw = row[key];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

const EARNINGS: { label: string; aliases: string[]; always?: boolean }[] = [
  { label: 'Basic',             aliases: ['basic'], always: true },
  { label: 'HRA',               aliases: ['hra'], always: true },
  { label: 'Conveyance',        aliases: ['conveyance'], always: true },
  { label: 'DA',                aliases: ['da', 'dearness_allowance'] },
  { label: 'Bonus (8.33%)',     aliases: ['bonus'] },
  { label: 'Special Allowance', aliases: ['special_allowance'] },
  { label: 'Other Allowance',   aliases: ['other_allowance'] },
  { label: 'LTA',               aliases: ['lta'] },
  { label: 'Medical',           aliases: ['medical'] },
  { label: 'Portfolio',         aliases: ['portfolio'] },
  { label: 'PLI',               aliases: ['pli'] },
];

const EMPLOYER_COST: { label: string; aliases: string[] }[] = [
  { label: 'PF (Employer)',      aliases: ['employer_pf', 'epf_employer', 'pf_employer'] },
  { label: 'ESIC (Employer)',    aliases: ['employer_esi', 'esic_employer'] },
  { label: 'Admin Charges (1%)', aliases: ['admin_charges'] },
  { label: 'Gratuity',           aliases: ['gratuity'] },
];

/** Earnings that make up gross. Basic/HRA/Conveyance always present; the rest when funded. */
export function earningRows(src: Source): ComponentRow[] {
  return EARNINGS
    .map((row) => ({ label: row.label, value: pick(src, row.aliases), always: row.always }))
    .filter((row) => row.always || row.value > 0)
    .map(({ label, value }) => ({ label, value }));
}

/**
 * Employee deductions OTHER than PF and ESIC — those two are rendered by each screen with
 * its own Yes/No eligibility label (see salaryEligibility.ts), so they stay out of here.
 */
export function otherDeductionRows(src: Source): ComponentRow[] {
  const pt = pick(src, ['professional_tax']);
  return pt > 0 ? [{ label: 'Professional Tax', value: pt }] : [];
}

/** Employer-side cost lines that sit between net and CTC. Only the funded ones. */
export function employerCostRows(src: Source): ComponentRow[] {
  return EMPLOYER_COST
    .map((row) => ({ label: row.label, value: pick(src, row.aliases) }))
    .filter((row) => row.value > 0);
}
