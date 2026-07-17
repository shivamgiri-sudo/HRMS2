export const VISIT_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "checked_in",
  "checked_out",
  "cancelled",
  "expired",
] as const;

export type VisitStatus = (typeof VISIT_STATUSES)[number];

export type VisitSource = "visitor_self" | "guard_desk" | "employee_invitation" | "event_import";

export interface VisitorIdentityInput {
  full_name: string;
  mobile: string;
  email?: string;
  company_name?: string;
}

export interface CreateVisitInput {
  visitor: VisitorIdentityInput;
  branch_id: string;
  host_employee_id?: string;
  host_employee_code?: string;
  visit_type: string;
  purpose: string;
  scheduled_start: string;
  scheduled_end: string;
  source_channel: VisitSource;
  created_by_user_id?: string;
  companions?: Array<{ full_name: string; mobile?: string; relationship_label?: string }>;
  vehicle?: { vehicle_number: string; vehicle_type?: string; parking_slot?: string };
  belongings?: Array<{ item_type: string; description?: string; serial_number?: string }>;
}

export interface ActorScope {
  userId: string;
  employeeId: string | null;
  branchId: string | null;
  roles: string[];
  unrestricted: boolean;
}

export interface VisitListFilters {
  branch_id?: string;
  host_employee_id?: string;
  status?: VisitStatus;
  date_from?: string;
  date_to?: string;
  search?: string;
  limit: number;
  offset: number;
}

export const VISIT_TRANSITIONS: Readonly<Record<VisitStatus, readonly VisitStatus[]>> = {
  pending_approval: ["approved", "rejected", "cancelled", "expired"],
  approved: ["checked_in", "cancelled", "expired"],
  rejected: [],
  checked_in: ["checked_out"],
  checked_out: [],
  cancelled: [],
  expired: [],
};

export function canTransitionVisit(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from]?.includes(to) ?? false;
}
