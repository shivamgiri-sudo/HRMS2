export type RequestKind = "swap" | "weekoff_rejection" | "dispute" | "conflict";
export type SlaState = "ok" | "due_soon" | "overdue" | "urgent";

export interface RosterRequest {
  key: string;            // `${kind}:${id}`
  kind: RequestKind;
  id: string;
  employeeId: string | null;
  employeeName: string;
  secondaryName: string | null;
  date: string;           // YYYY-MM-DD
  reason: string | null;
  counterpartStatus: string | null; // swap only (pending/accepted/declined)
  raisedAt: string;
  slaState: SlaState;
  ageHours: number;
  raw: unknown;
}

export const KIND_LABEL: Record<RequestKind, string> = {
  swap: "Shift swap",
  weekoff_rejection: "Week-off rejected",
  dispute: "Roster dispute",
  conflict: "Roster conflict",
};
