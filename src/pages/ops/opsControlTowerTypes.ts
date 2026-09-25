// Shapes returned by /api/ops-control-tower (backend: ops-control-tower.service.ts).

export const JOIN_BUCKETS = ["Same day", "-1", "-2", "-3", "-4", "-5", ">5"] as const;
export type JoinBucket = (typeof JOIN_BUCKETS)[number];

export interface BranchRef {
  branchId: string;
  branchName: string;
}

export interface CountRow extends BranchRef {
  count: number;
}
export interface CountBlock {
  branches: CountRow[];
  grandTotal: number;
}

export interface DateRow extends BranchRef {
  lastDateMs: number | null;
  stale: boolean;
}
export interface DateBlock {
  branches: DateRow[];
}

export interface MismatchRow extends BranchRef {
  count: number;
  correctionLastDateMs: number | null;
  stale: boolean;
}
export interface MismatchBlock {
  branches: MismatchRow[];
  grandTotal: number;
}

export interface JoiningRow extends BranchRef {
  total: number;
  buckets: Record<JoinBucket, number>;
}
export interface JoiningBlock {
  branches: JoiningRow[];
  grandTotal: number;
  grandBuckets: Record<JoinBucket, number>;
}

export interface OpsControlTowerSummary {
  nowMs: number;
  esignSlaDays: number;
  appointmentLetterSlaDays: number;
  attendanceMismatch: MismatchBlock;
  rosterUploaded: DateBlock;
  joining: JoiningBlock;
  fnfPending: CountBlock;
  nocPending: CountBlock;
  digilockerPending: CountBlock;
  esignPending: CountBlock;
  appointmentLetter: CountBlock;
  pennyDropMissing: CountBlock;
  accountDetailsMissing: CountBlock;
  bgvPending: CountBlock;
  itProvisioningPending: CountBlock;
  adminProvisioningPending: CountBlock;
  wfmProvisioningPending: CountBlock;
}

export type DetailBlockKey =
  | "attendance-mismatch"
  | "fnf-pending"
  | "noc-pending"
  | "digilocker-pending"
  | "esign-pending"
  | "appointment-letter"
  | "penny-drop-missing"
  | "account-details-missing"
  | "bgv-pending"
  | "it-provisioning-pending"
  | "admin-provisioning-pending"
  | "wfm-provisioning-pending";

export interface AttendanceMismatchDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  issueDate: string;
  issueType: string;
  daysOpen: number;
}
export interface FnfDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
  netPayable: number;
}
export interface NocDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
}
export interface OnboardingDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
}
/** Shared by the two Day-N SLA blocks: eSign (Day 3) and Appointment letter (Day 7). */
export interface SlaDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  dueDateMs: number;
  daysOverdue: number;
}

export type DetailRow =
  | AttendanceMismatchDetailRow
  | FnfDetailRow
  | NocDetailRow
  | OnboardingDetailRow
  | SlaDetailRow;
