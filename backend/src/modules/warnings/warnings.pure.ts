/** Pure rules for employee warnings - who may see which fields, and the allowed values. */

export const WARNING_CATEGORIES = [
  "attendance",
  "conduct",
  "performance",
  "policy_violation",
  "integrity",
  "other",
] as const;
export const WARNING_SEVERITIES = ["verbal", "written", "final"] as const;

export type WarningCategory = (typeof WARNING_CATEGORIES)[number];
export type WarningSeverity = (typeof WARNING_SEVERITIES)[number];

export interface WarningRecord {
  id: string;
  employeeId: string;
  warningDate: string;
  category: string;
  severity: string;
  description: string;
  remarks: string | null;
  status: "active" | "withdrawn";
  issuedByName: string | null;
  withdrawnAt: string | null;
  withdrawnByName: string | null;
  withdrawnReason: string | null;
  createdAt: string;
}

/** The employee sees the warning itself; the issuer's internal remarks are for the reporting line and HR only. */
export function forEmployeeView(record: WarningRecord): WarningRecord {
  return { ...record, remarks: null };
}

export type ViewerRelation = "self" | "hr" | "span";

export function forViewer(
  records: WarningRecord[],
  relation: ViewerRelation,
): WarningRecord[] {
  return relation === "self" ? records.map(forEmployeeView) : records;
}
