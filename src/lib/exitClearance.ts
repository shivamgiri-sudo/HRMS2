/**
 * Shared status vocabulary for exit_clearance_task rows (clearance_area ENUM's status
 * column: pending/in_progress/cleared/blocked/waived) — used by every surface that shows
 * these 9 tasks: NoticePeriodDrawer, ExitClearanceQueue, and the Exit Task Board.
 *
 * Deliberately separate from NativeITProvisioningTracker.tsx's own StatusBadge, which
 * colors a DIFFERENT status vocabulary (it_provisioning_request's
 * pending/pending_unassigned/actioned/confirmed/waived) for a different table — the two
 * systems' statuses only coincidentally share some label text.
 */

export const CLEARANCE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  cleared: "Cleared",
  blocked: "Blocked",
  waived: "Waived",
};

export const CLEARANCE_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  cleared: "bg-emerald-100 text-emerald-700",
  blocked: "bg-red-100 text-red-700",
  waived: "bg-slate-100 text-slate-600",
};

export const NOC_STATUS_LABELS: Record<string, string> = {
  invited: "Invited",
  employee_submitted: "Employee submitted",
  in_progress: "In progress",
  declined: "Declined",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const NOC_STATUS_COLORS: Record<string, string> = {
  invited: "bg-amber-100 text-amber-700",
  employee_submitted: "bg-blue-100 text-blue-700",
  in_progress: "bg-blue-100 text-blue-700",
  declined: "bg-red-100 text-red-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-600",
};

// 'it' added 2026-09-15 — "IT access closure" moved from owner_role='admin' to 'it'
// (owner ruling; migration 1772 backfilled existing rows). 'trainer' removed same day —
// trainer clearance dropped from the exit process entirely (migration 1774).
export const CLEARANCE_OWNER_ROLES = ["manager", "hr", "admin", "wfm", "payroll", "it"] as const;
export type ClearanceOwnerRole = typeof CLEARANCE_OWNER_ROLES[number];

export interface ExitClearanceTaskRow {
  id: string;
  exit_request_id: string;
  employee_id: string;
  clearance_area: string;
  task_title: string;
  task_description?: string | null;
  owner_role: string;
  due_date?: string | null;
  status: string;
  remarks?: string | null;
  attachment_url?: string | null;
  cleared_by?: string | null;
  cleared_at?: string | null;
  created_at: string;
  updated_at: string;
  employee_name?: string | null;
  employee_code?: string | null;
  branch_name?: string | null;
  process_name?: string | null;
  exit_status?: string | null;
  last_working_day_confirmed?: string | null;
  last_working_day_proposed?: string | null;
  noc_case_status?: string | null;
}
