/**
 * ONE glossary for every Process P&L surface (audit items 23, 24, 28).
 *
 * The same concept used to carry a different name on each tab — Recognized / Recognised revenue,
 * Invoiced revenue, People cost / Payroll cost / Payroll, Vendor (GRN) cost / GRN actual / Total
 * Indirect Cost, Operating margin / Margin / OP% / Indicative OP / OP*, Staff / paid / Active HC —
 * so a reader comparing tabs could not tell whether two figures were meant to agree. Every P&L
 * component takes its label (and tooltip) from here, in British spelling throughout.
 *
 * Where two figures legitimately differ by design they get clearly different names, each with a
 * one-line tooltip saying how it differs from the other:
 *   - OPERATING_PROFIT_CONTRIBUTION (CEO Overview, Live P&L) vs OPERATING_PROFIT (P&L Statement)
 *   - OPERATING_PROFIT_CONTRIBUTION (headline, before D&A) vs EBIT (Full P&L Waterfall, after D&A)
 */
export interface PnlTerm {
  label: string;
  tooltip: string;
}

export const PNL_TERMS = {
  RECOGNISED_REVENUE: {
    label: "Recognised Revenue",
    tooltip:
      "Invoiced revenue, plus the billing-provision top-up where the provision exceeds what was invoiced, plus a seat rate × seats estimate for cost centres not invoiced yet; net of credit notes. All amounts ex-GST (taxable value, GST excluded).",
  },
  INVOICED_REVENUE: {
    label: "of which Invoiced",
    tooltip: "The part of Recognised Revenue backed by raised invoices, ex-GST (taxable value).",
  },
  PEOPLE_COST: {
    label: "People Cost",
    tooltip:
      "Salary cost of staff: the posted payroll run when it exists for the month, otherwise the running (earned-to-date) salary snapshot.",
  },
  INDIRECT_COST: {
    label: "Indirect Cost (GRN)",
    tooltip:
      "Vendor spend booked through GRNs against the month, ex-GST (amount without tax; no GST is counted, recoverable or not): GRN Consumed, plus GRN Committed (reserved) while the month's estimate window is open.",
  },
  GRN_CONSUMED: {
    label: "GRN Consumed",
    tooltip: "GRN spend already consumed against bills for the month, ex-GST (amount without tax).",
  },
  GRN_COMMITTED: {
    label: "GRN Committed (reserved)",
    tooltip:
      "Approved GRN spend reserved but not yet consumed, ex-GST (amount without tax) — a committed estimate for the open month, subtracted in Operating Profit so it is not overstated.",
  },
  OPERATING_PROFIT: {
    label: "Operating Profit",
    tooltip:
      "P&L Statement waterfall: Recognised Revenue − Total Cost (Agent + DSC + BMC salary + Indirect Cost), before depreciation, finance cost and tax. Built from the Statement's own cost lines, so it can differ from Operating Profit (contribution) on CEO Overview and Live P&L.",
  },
  OPERATING_PROFIT_CONTRIBUTION: {
    label: "Operating Profit (contribution)",
    tooltip:
      "Recognised Revenue − People Cost − Indirect Cost (GRN Consumed + Committed), before depreciation, finance cost and tax. The same figure on CEO Overview and Live P&L; the P&L Statement's Operating Profit is built from its own Agent/DSC/BMC lines and can differ.",
  },
  OPERATING_MARGIN: {
    label: "Operating Margin %",
    tooltip: "Operating Profit as a percentage of Recognised Revenue.",
  },
  EBIT: {
    label: "EBIT (after depreciation & amortisation)",
    tooltip:
      "Earnings before interest and tax: EBITDA minus depreciation and amortisation. Lower than the headline Operating Profit (contribution), which is before depreciation and amortisation.",
  },
  ACTIVE_HEADCOUNT: {
    label: "Active Headcount",
    tooltip: "Employees active on the rolls in the period, whether or not they were paid.",
  },
  PAID_STAFF: {
    label: "Paid Staff",
    tooltip: "Employees with a non-zero salary cost in the period — the people People Cost covers.",
  },
} as const satisfies Record<string, PnlTerm>;

export type PnlTermKey = keyof typeof PNL_TERMS;

/** Shorthand for the label of a glossary term. */
export const pnlLabel = (key: PnlTermKey): string => PNL_TERMS[key].label;

/** Shorthand for the tooltip of a glossary term. */
export const pnlTooltip = (key: PnlTermKey): string => PNL_TERMS[key].tooltip;
