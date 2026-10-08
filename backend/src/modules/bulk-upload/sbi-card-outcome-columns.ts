import type { ColumnSpec } from "./report-column-plan.js";

/**
 * Column plan of the cycle-outcome report. SBI Card has not yet sent a sample, so the layout is ours and deliberately forgiving:
 * counts, amounts and percentages are all optional, headers are matched by name / synonym / near-match, and the order does not matter.
 * Report Date and Segment are the row identity (a blank Segment means the default payout segment).
 */
export const SBI_OUTCOME_COLUMNS: ColumnSpec[] = [
  { canonical: "Report Date", aliases: ["Date", "As On", "As At", "As On Date", "Report Day", "Cycle Date", "MTD Date"] },
  { canonical: "Segment", aliases: ["Portfolio", "Bucket", "Call Table", "Product Segment", "Cohort", "Pool"] },
  { canonical: "Opening Accounts", aliases: ["Opening Count", "Allocated Accounts", "Allocation", "Base Accounts", "Opening Base", "Total Accounts", "Opening Book Accounts", "Accounts Allocated"] },
  { canonical: "Opening Amount", aliases: ["Opening POS", "Opening Balance", "Allocated Amount", "Base Amount", "Opening Book Amount", "Total Amount"] },
  { canonical: "Resolved Accounts", aliases: ["Resolution Accounts", "Resolution Count", "Resolved Count", "RES Accounts", "Resolved", "Res Count", "Resolution"] },
  { canonical: "Normalised Accounts", aliases: ["Normalized Accounts", "Normalisation Accounts", "Normalization Accounts", "Normalised Count", "Normalized Count", "NM Accounts", "Normalised", "Normalized", "Norm Count"] },
  { canonical: "Rollback Accounts", aliases: ["Roll Back Accounts", "Rollback Count", "RB Accounts", "Rolled Back Accounts", "Rollback", "Roll Back", "Rolled Back"] },
  { canonical: "Resolved Amount", aliases: ["Resolution Amount", "RES Amount", "Resolved POS"] },
  { canonical: "Normalised Amount", aliases: ["Normalized Amount", "Normalisation Amount", "Normalization Amount", "NM Amount", "Normalised POS"] },
  { canonical: "Rollback Amount", aliases: ["Roll Back Amount", "RB Amount", "Rolled Back Amount", "Rollback POS"] },
  { canonical: "Resolution %", aliases: ["Resolution Pct", "Res %", "Resolution Rate", "Res Rate", "RES%", "Resolved %", "Resolution Percent"] },
  { canonical: "Normalisation %", aliases: ["Normalization %", "Normalised %", "Normalized %", "Norm %", "NM %", "NM%", "Normalisation Rate", "Normalisation Pct", "Normalization Pct"] },
  { canonical: "Rollback %", aliases: ["Roll Back %", "Rolled Back %", "RB %", "RB%", "Rollback Rate", "Rollback Pct", "Roll Back Pct"] },
];
