import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, BookOpen, ChevronDown, EyeOff,
  Loader, MessageSquare, Plus, RefreshCcw, Search, Star, ThumbsDown,
  ThumbsUp, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { StatusBadge as SmartHRStatusBadge, normalizeStatus } from "@/components/ui/status-badge";
import { formatISTDate, formatIST } from "@/lib/utils";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";

// ─── Support Request Categories & Sub-categories ──────────────────────────────
// IT taxonomy supplied verbatim 2026-08-24 (6 groups, 28 issue types). The other 8
// departments' lists were authored by Claude the same day — not given verbatim like IT's —
// as a reasonable first cut for a BPO/call-centre HR platform; review and adjust before
// treating any non-IT list as final.
//
// All of this is stored in one column, `helpdesk_ticket.it_subcategory` — a free-text VARCHAR
// with no backend enum/whitelist (confirmed in helpdesk.service.ts), so nothing here required
// a schema change. The column's IT-specific name is now a known naming debt: every category,
// not just IT, writes its subcategory into a column called "it_subcategory". A proper fix is a
// small additive migration renaming/aliasing it to a generic `subcategory` column — flagged,
// not silently done, since it touches ~10 read/write sites across this file and the backend
// service and deserves its own reviewed change rather than being folded into this one.
//
// Label is "Category — Issue" so the grouping stays visible in the flat <select> every call
// site renders this into — no JSX/optgroup changes needed at any use site.

const SUBCATEGORIES_BY_CATEGORY: Record<string, { value: string; label: string }[]> = {
  it: [
    // 1. Desktop Issue
    { value: "it_desktop_internet_issue",           label: "Desktop Issue — Internet Issue" },
    { value: "it_desktop_monitor_issue",            label: "Desktop Issue — Monitor Issue" },
    { value: "it_desktop_auto_restart_shutdown",    label: "Desktop Issue — System Auto Restart / Shutdown" },
    { value: "it_desktop_wont_start",               label: "Desktop Issue — Computer Won't Start" },
    { value: "it_desktop_bitlocker_issue",          label: "Desktop Issue — BitLocker Issue" },
    { value: "it_desktop_keyboard_issue",           label: "Desktop Issue — Keyboard Issue" },
    { value: "it_desktop_mouse_issue",              label: "Desktop Issue — Mouse Issue" },
    { value: "it_desktop_system_hang",              label: "Desktop Issue — System Hang" },
    // 2. Computer Peripheral
    { value: "it_peripheral_new_employee_device",   label: "Computer Peripheral — Laptop/Desktop Ordering – New Employee" },
    { value: "it_peripheral_printer_issue",         label: "Computer Peripheral — Printer Issue" },
    { value: "it_peripheral_new_headphones_order",  label: "Computer Peripheral — New Headphones Ordering" },
    // 3. Telecom and Voice
    { value: "it_telecom_headphone_not_working",    label: "Telecom and Voice — Headphone Not Working" },
    { value: "it_telecom_voice_issue",              label: "Telecom and Voice — Voice Issue" },
    { value: "it_telecom_sim_configuration_req",    label: "Telecom and Voice — SIM Configuration Required" },
    { value: "it_telecom_dialer_issue",             label: "Telecom and Voice — Dialer Issue" },
    { value: "it_telecom_new_sim_configuration",    label: "Telecom and Voice — New SIM Configuration" },
    { value: "it_telecom_sim_gateway_testing",      label: "Telecom and Voice — SIM Required from Gateway for Testing" },
    // 4. Password Reset / Changed
    { value: "it_password_domain_change",           label: "Password Reset / Changed — Domain Password Change" },
    { value: "it_password_email_change",            label: "Password Reset / Changed — Email Password Change" },
    // 5. Seating Change Request
    { value: "it_seating_change_request",           label: "Seating Change Request — Seating Change Request" },
    // 6. Software
    { value: "it_software_browser_issue",           label: "Software — Browser Issue" },
    { value: "it_software_email_configuration",     label: "Software — Email Configuration" },
    { value: "it_software_mail_issue",              label: "Software — Mail Issue" },
    { value: "it_software_installation_required",   label: "Software — Software Installation Required" },
    { value: "it_software_wfm_hardening",           label: "Software — WFM System Hardening / Un-hardening" },
    { value: "it_software_windows_install_upgrade", label: "Software — Windows Installation / Upgrade" },
    { value: "other_it",                            label: "Other IT" },
  ],
  hr: [
    { value: "hr_records_personal_details_update",  label: "Employee Records — Personal Details Update" },
    { value: "hr_records_employment_letter",        label: "Employee Records — Employment Letter Request" },
    { value: "hr_records_experience_letter",        label: "Employee Records — Experience Letter Request" },
    { value: "hr_records_id_card_issue_reissue",    label: "Employee Records — ID Card Issue / Reissue" },
    { value: "hr_onboarding_document_submission",   label: "Onboarding & Documentation — Document Submission Issue" },
    { value: "hr_onboarding_offer_letter_query",    label: "Onboarding & Documentation — Offer Letter Query" },
    { value: "hr_onboarding_bgv_query",             label: "Onboarding & Documentation — Background Verification Query" },
    { value: "hr_onboarding_joining_formalities",   label: "Onboarding & Documentation — Joining Formalities Issue" },
    { value: "hr_policy_company_policy_query",      label: "Policy & Compliance — Company Policy Clarification" },
    { value: "hr_policy_code_of_conduct_query",     label: "Policy & Compliance — Code of Conduct Query" },
    { value: "hr_policy_compliance_doc_request",    label: "Policy & Compliance — Compliance Document Request" },
    { value: "hr_benefits_insurance_medical_query",  label: "Benefits & Welfare — Insurance / Medical Benefit Query" },
    { value: "hr_benefits_esic_card_issue",          label: "Benefits & Welfare — ESIC Card Issue" },
    { value: "hr_benefits_gratuity_query",           label: "Benefits & Welfare — Gratuity Query" },
    { value: "hr_benefits_engagement_query",         label: "Benefits & Welfare — Employee Engagement Query" },
    { value: "hr_exit_resignation_process_query",   label: "Exit Formalities — Resignation Process Query" },
    { value: "hr_exit_fnf_query",                   label: "Exit Formalities — Full & Final Settlement Query" },
    { value: "hr_exit_relieving_letter_request",    label: "Exit Formalities — Relieving Letter Request" },
    { value: "hr_exit_interview_scheduling",        label: "Exit Formalities — Exit Interview Scheduling" },
    { value: "other_hr",                            label: "Other HR" },
  ],
  payroll: [
    { value: "payroll_salary_not_credited",         label: "Salary Issues — Salary Not Credited" },
    { value: "payroll_salary_discrepancy",          label: "Salary Issues — Salary Discrepancy" },
    { value: "payroll_incorrect_deduction",         label: "Salary Issues — Incorrect Deduction" },
    { value: "payroll_arrears_not_paid",            label: "Salary Issues — Arrears Not Paid" },
    { value: "payroll_payslip_not_available",       label: "Payslip & Documents — Payslip Not Available" },
    { value: "payroll_form16_request",              label: "Payslip & Documents — Form 16 Request" },
    { value: "payroll_salary_certificate_request",  label: "Payslip & Documents — Salary Certificate Request" },
    { value: "payroll_tds_certificate_query",       label: "Payslip & Documents — TDS Certificate Query" },
    { value: "payroll_pf_withdrawal_query",         label: "Statutory Deductions — PF Withdrawal Query" },
    { value: "payroll_pf_transfer_query",           label: "Statutory Deductions — PF Transfer Query" },
    { value: "payroll_uan_activation_issue",        label: "Statutory Deductions — UAN Activation Issue" },
    { value: "payroll_esic_deduction_query",        label: "Statutory Deductions — ESIC Deduction Query" },
    { value: "payroll_professional_tax_query",      label: "Statutory Deductions — Professional Tax Query" },
    { value: "payroll_travel_reimb_pending",        label: "Reimbursements — Travel Reimbursement Pending" },
    { value: "payroll_medical_reimb_pending",       label: "Reimbursements — Medical Reimbursement Pending" },
    { value: "payroll_reimb_rejected",              label: "Reimbursements — Reimbursement Rejected" },
    { value: "payroll_bank_account_update",         label: "Bank & Payment — Bank Account Update" },
    { value: "payroll_salary_account_not_linked",   label: "Bank & Payment — Salary Account Not Linked" },
    { value: "payroll_neft_failure_query",          label: "Bank & Payment — NEFT Failure Query" },
    { value: "other_payroll",                       label: "Other Payroll" },
  ],
  attendance: [
    { value: "attendance_missed_punch",             label: "Punch Issues — Missed Punch" },
    { value: "attendance_biometric_not_working",    label: "Punch Issues — Biometric Not Working" },
    { value: "attendance_punch_not_reflecting",     label: "Punch Issues — Punch Not Reflecting" },
    { value: "attendance_duplicate_punch",          label: "Punch Issues — Duplicate Punch" },
    { value: "attendance_regularization_pending",   label: "Regularization — Regularization Request Pending" },
    { value: "attendance_regularization_rejected",  label: "Regularization — Regularization Rejected" },
    { value: "attendance_wfh_marking_issue",        label: "Regularization — WFH Marking Issue" },
    { value: "attendance_leave_marked_absent",      label: "Leave-Attendance Mismatch — Leave Marked as Absent" },
    { value: "attendance_approved_leave_missing",   label: "Leave-Attendance Mismatch — Approved Leave Not Reflecting" },
    { value: "attendance_shift_not_assigned",       label: "Roster & Shift — Shift Not Assigned" },
    { value: "attendance_roster_not_published",     label: "Roster & Shift — Roster Not Published" },
    { value: "attendance_shift_change_request",     label: "Roster & Shift — Shift Change Request" },
    { value: "attendance_ot_not_approved",          label: "Overtime — OT Not Approved" },
    { value: "attendance_ot_not_reflecting",        label: "Overtime — OT Not Reflecting in Attendance" },
    { value: "other_attendance",                    label: "Other Attendance" },
  ],
  leave: [
    { value: "leave_not_approved",                  label: "Leave Application — Leave Not Approved" },
    { value: "leave_application_error",             label: "Leave Application — Leave Application Error" },
    { value: "leave_balance_incorrect",             label: "Leave Application — Leave Balance Incorrect" },
    { value: "leave_casual_query",                  label: "Leave Types — Casual Leave Query" },
    { value: "leave_sick_query",                    label: "Leave Types — Sick Leave Query" },
    { value: "leave_earned_query",                  label: "Leave Types — Earned Leave Query" },
    { value: "leave_maternity_paternity_query",     label: "Leave Types — Maternity / Paternity Leave Query" },
    { value: "leave_comp_off_query",                label: "Leave Types — Comp-Off Query" },
    { value: "leave_approver_not_responding",       label: "Approval Workflow — Approver Not Responding" },
    { value: "leave_wrong_approver_assigned",       label: "Approval Workflow — Wrong Approver Assigned" },
    { value: "leave_encashment_query",              label: "Leave Encashment — Leave Encashment Query" },
    { value: "leave_carry_forward_query",           label: "Leave Encashment — Leave Carry Forward Query" },
    { value: "other_leave",                         label: "Other Leave" },
  ],
  asset: [
    { value: "asset_new_request",                   label: "Asset Issuance — New Asset Request" },
    { value: "asset_not_received",                  label: "Asset Issuance — Asset Not Received" },
    { value: "asset_handover_pending",              label: "Asset Issuance — Asset Handover Pending" },
    { value: "asset_damaged",                       label: "Asset Issues — Asset Damaged" },
    { value: "asset_malfunction",                   label: "Asset Issues — Asset Malfunction" },
    { value: "asset_accessory_missing",             label: "Asset Issues — Accessory Missing" },
    { value: "asset_return_pending",                label: "Asset Return / Exit — Asset Return Pending" },
    { value: "asset_clearance_for_exit",            label: "Asset Return / Exit — Asset Clearance for Exit" },
    { value: "asset_not_mapped_to_employee",        label: "Asset Records — Asset Not Mapped to Employee" },
    { value: "asset_incorrect_details",             label: "Asset Records — Incorrect Asset Details" },
    { value: "other_asset",                         label: "Other Asset" },
  ],
  admin: [
    { value: "admin_ac_electrical_issue",           label: "Facility — AC / Electrical Issue" },
    { value: "admin_furniture_issue",               label: "Facility — Furniture Issue" },
    { value: "admin_housekeeping_issue",            label: "Facility — Housekeeping Issue" },
    { value: "admin_pantry_cafeteria_issue",        label: "Facility — Pantry / Cafeteria Issue" },
    { value: "admin_access_card_not_working",       label: "Access & Security — Access Card Not Working" },
    { value: "admin_visitor_pass_request",          label: "Access & Security — Visitor Pass Request" },
    { value: "admin_parking_access_request",        label: "Access & Security — Parking Access Request" },
    { value: "admin_cab_booking_issue",             label: "Transport — Cab Booking Issue" },
    { value: "admin_cab_not_arrived",               label: "Transport — Cab Not Arrived" },
    { value: "admin_transport_route_query",         label: "Transport — Transport Route Query" },
    { value: "admin_stationery_request",            label: "Stationery & Supplies — Stationery Request" },
    { value: "admin_office_supplies_shortage",      label: "Stationery & Supplies — Office Supplies Shortage" },
    { value: "admin_vendor_service_complaint",      label: "Vendor / Facility — Vendor Service Complaint" },
    { value: "admin_facility_maintenance_request",  label: "Vendor / Facility — Facility Maintenance Request" },
    { value: "other_admin",                         label: "Other Admin" },
  ],
  general: [
    { value: "general_hr_query",                    label: "General Query — General HR Query" },
    { value: "general_it_query",                    label: "General Query — General IT Query" },
    { value: "general_query_other",                 label: "General Query — Other" },
    { value: "general_process_improvement",         label: "Feedback & Suggestion — Process Improvement Suggestion" },
    { value: "general_feedback_on_service",         label: "Feedback & Suggestion — Feedback on Service" },
    { value: "general_miscellaneous_request",       label: "Miscellaneous — Miscellaneous Request" },
    { value: "other_general",                       label: "Other" },
  ],
  other: [
    { value: "other_not_listed_above",              label: "Other — Not Listed Above" },
  ],
};

// Backward-compatible name for the IT list specifically — every existing call site in this
// file that only ever handled IT tickets keeps working unchanged.
const BPO_IT_SUBCATEGORIES = SUBCATEGORIES_BY_CATEGORY.it;

// Flat list of every sub-category across every department, for label look-ups where the
// relevant ticket's category isn't in scope at that point in the code — every `value` above is
// globally unique (category-prefixed), so a single flattened search is safe regardless of which
// department a given ticket actually belongs to.
const ALL_SUBCATEGORIES = Object.values(SUBCATEGORIES_BY_CATEGORY).flat();

/** Sub-category options for whatever category string a form/ticket currently holds (case- and
 * whitespace-insensitive — this file mixes "IT"/"it" category casing between forms). Falls back
 * to the "other" list for an unrecognized category rather than showing nothing. */
function subcategoriesFor(category: string | undefined | null): { value: string; label: string }[] {
  const key = (category ?? "").trim().toLowerCase();
  return SUBCATEGORIES_BY_CATEGORY[key] ?? SUBCATEGORIES_BY_CATEGORY.other;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Ticket = {
  id: string;
  ticket_number?: string;
  ticket_code?: string;
  category: string;
  it_subcategory?: string;
  subject: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "pending_info" | "on_hold" | "resolved" | "closed";
  assigned_to?: string;
  assigned_name?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  sla_due_at?: string;
  sla_breached?: boolean;
  downtime_minutes?: number;
  affected_seats?: number;
  hold_reason?: string;
  held_at?: string;
  closure_rating?: number;
  escalation_level?: number;
  full_name?: string;
  branch_id?: string;
  branch_name?: string;
  process_name?: string;
  employee_code?: string;
};

type Comment = {
  id: string;
  text: string;
  is_internal: boolean;
  created_by?: string;
  author_name?: string;
  created_at: string;
};

type TicketDetail = Ticket & { comments?: Comment[] };

type Grievance = {
  id: string;
  subject: string;
  description: string;
  grievance_type: string;
  status: string;
  is_anonymous: boolean;
  severity?: string;
  created_at: string;
};

type TicketForm = {
  category: string;
  it_subcategory: string;
  subject: string;
  description: string;
  priority: string;
  downtime_minutes: number;
  affected_seats: number;
};

type GrievanceForm = {
  subject: string;
  description: string;
  grievance_type: string;
  severity: string;
  is_anonymous: boolean;
};

type KbArticle = {
  id: string;
  title: string;
  category: string;
  it_subcategory?: string;
  content?: string;
  tags?: string;
  status: string;
  view_count: number;
  helpful_count: number;
  not_helpful_count: number;
  author_name?: string;
  created_at: string;
};

type Agent = { id: string; full_name: string; email?: string; branch_name?: string; role_key?: string };

// ─── Badge helpers ────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  low:    "bg-slate-100 text-slate-600",
  medium: "bg-blue-50 text-blue-700",
  high:   "bg-amber-50 text-amber-700",
  urgent: "bg-red-50 text-red-700",
};

function PriorityBadge({ priority }: { priority: string }) {
  const cls = PRIORITY_STYLES[priority] ?? "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{priority}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, string> = {
    open: "in_progress",
    in_progress: "in_progress",
    on_hold: "warning",
    resolved: "success",
    closed: "cancelled",
    pending: "pending",
    under_review: "warning",
  };
  return (
    <SmartHRStatusBadge
      status={normalizeStatus(statusMap[status] || status)}
      label={status.replace(/_/g, " ")}
    />
  );
}

function SlaBadge({ sla_due_at, sla_breached, status }: { sla_due_at?: string; sla_breached?: boolean; status: string }) {
  if (!sla_due_at || ["resolved", "closed", "cancelled", "on_hold"].includes(status)) return null;
  if (sla_breached) {
    return <span className="rounded-full px-2.5 py-0.5 text-xs font-bold bg-red-50 text-red-700">SLA Breached</span>;
  }
  const due = new Date(sla_due_at);
  const minsLeft = Math.floor((due.getTime() - Date.now()) / 60000);
  if (minsLeft < 0) return <span className="rounded-full px-2.5 py-0.5 text-xs font-bold bg-red-50 text-red-700">Breached</span>;
  if (minsLeft <= 60)  return <span className="rounded-full px-2.5 py-0.5 text-xs font-bold bg-amber-50 text-amber-700">Due &lt;1h</span>;
  if (minsLeft <= 240) return <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-yellow-50 text-yellow-700">Due {Math.round(minsLeft / 60)}h</span>;
  return <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700">On Time</span>;
}

const inputCls = "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";
const btnPrimary = "inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50";
const btnSecondary = "inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "tickets" | "grievances" | "kb";

// 'closed' removed as a filter option (2026-08-24) — 'resolved' is now the only terminal
// status for tickets, confirmed live: no ticket has ever been in 'closed' status. The "closed"
// value stays in the Ticket type below for safety reading old/unexpected data, just isn't
// offered as something to filter by anymore.
const STATUS_FILTER_TABS = [
  { key: "all",          label: "All" },
  { key: "open",         label: "Open" },
  { key: "in_progress",  label: "In Progress" },
  { key: "pending_info", label: "Pending Info" },
  { key: "on_hold",      label: "On Hold" },
  { key: "resolved",     label: "Resolved" },
];

export default function NativeHelpdesk() {
  const { roleKeys } = useWorkforceAccess();
  const { user } = useAuth();
  const isAdminMode = roleKeys.some(r =>
    ["admin", "hr", "super_admin", "it", "branch_it", "it_admin"].includes(r)
  );

  const [tab, setTab] = useState<Tab>("tickets");
  const [message, setMessage] = useState("");

  // ── Tickets state ────────────────────────────────────────────────────────────

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false);

  const [showRaiseTicket, setShowRaiseTicket] = useState(false);
  const [ticketForm, setTicketForm] = useState<TicketForm>({
    category: "IT", it_subcategory: "", subject: "", description: "",
    priority: "medium", downtime_minutes: 0, affected_seats: 1,
  });
  const [ticketBusy, setTicketBusy] = useState(false);

  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [internalNoteTab, setInternalNoteTab] = useState<"public" | "internal">("public");

  const [myTicketsOnly, setMyTicketsOnly] = useState(false);

  // Admin action state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [assignToUserId, setAssignToUserId] = useState("");
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [showHoldPanel, setShowHoldPanel] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [showResolvePanel, setShowResolvePanel] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveRootCause, setResolveRootCause] = useState("");
  const [resolveDowntime, setResolveDowntime] = useState(0);
  const [resolveSubcategory, setResolveSubcategory] = useState("");

  // CSAT
  const [csatRating, setCsatRating] = useState(0);
  const [csatBusy, setCsatBusy] = useState(false);

  // ── Grievances state ─────────────────────────────────────────────────────────

  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [grievancesLoading, setGrievancesLoading] = useState(false);
  const [showRaiseGrievance, setShowRaiseGrievance] = useState(false);
  const [grievanceForm, setGrievanceForm] = useState<GrievanceForm>({
    subject: "", description: "", grievance_type: "workplace", severity: "medium", is_anonymous: false,
  });
  const [grievanceBusy, setGrievanceBusy] = useState(false);

  // ── KB state ─────────────────────────────────────────────────────────────────

  const [kbArticles, setKbArticles] = useState<KbArticle[]>([]);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbSearch, setKbSearch] = useState("");
  const [selectedKbArticle, setSelectedKbArticle] = useState<KbArticle | null>(null);
  const [kbVoteBusy, setKbVoteBusy] = useState(false);
  const [showCreateKb, setShowCreateKb] = useState(false);
  const [kbForm, setKbForm] = useState({ title: "", category: "it", it_subcategory: "", content: "", tags: "", status: "published" });
  const [kbFormBusy, setKbFormBusy] = useState(false);

  const kbSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadTickets = async () => {
    setTicketsLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ data: Ticket[] }>("/api/helpdesk/tickets");
      setTickets(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setTicketsLoading(false);
    }
  };

  const loadTicketDetail = async (id: string) => {
    setTicketDetailLoading(true);
    try {
      const res = await hrmsApi.get<{ data: TicketDetail }>(`/api/helpdesk/tickets/${id}`);
      setSelectedTicket(res.data);
      setCsatRating(res.data?.closure_rating ?? 0);
      if (isAdminMode) void loadAgents((res.data as any)?.branch_id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load ticket");
    } finally {
      setTicketDetailLoading(false);
    }
  };

  const loadAgents = useCallback(async (branchId?: string) => {
    if (!isAdminMode) return;
    try {
      const params = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : "";
      const res = await hrmsApi.get<{ data: Agent[] }>(`/api/helpdesk/agents${params}`);
      setAgents(res.data ?? []);
    } catch { /* non-fatal */ }
  }, [isAdminMode]);

  const loadGrievances = async () => {
    setGrievancesLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ data: Grievance[] }>("/api/helpdesk/grievances");
      setGrievances(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load grievances");
    } finally {
      setGrievancesLoading(false);
    }
  };

  const loadKbArticles = useCallback(async (search?: string) => {
    setKbLoading(true);
    try {
      const params = new URLSearchParams();
      if (search?.trim()) params.set("search", search.trim());
      const res = await hrmsApi.get<{ data: KbArticle[] }>(`/api/helpdesk/kb?${params}`);
      setKbArticles(res.data ?? []);
    } catch { /* non-fatal */ }
    finally { setKbLoading(false); }
  }, []);

  const loadKbArticleDetail = async (id: string) => {
    try {
      const res = await hrmsApi.get<{ data: KbArticle }>(`/api/helpdesk/kb/${id}`);
      setSelectedKbArticle(res.data);
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    if (tab === "tickets") {
      void loadTickets();
      if (isAdminMode) void loadAgents();
    } else if (tab === "grievances") {
      void loadGrievances();
    } else if (tab === "kb") {
      void loadKbArticles();
    }
  }, [tab, isAdminMode, loadAgents, loadKbArticles]);

  // ── Ticket actions ────────────────────────────────────────────────────────────

  const submitTicket = async () => {
    if (!ticketForm.subject.trim() || !ticketForm.description.trim()) {
      return setMessage("Subject and description are required.");
    }
    setTicketBusy(true);
    try {
      await hrmsApi.post("/api/helpdesk/tickets", ticketForm);
      setShowRaiseTicket(false);
      setTicketForm({ category: "IT", it_subcategory: "", subject: "", description: "", priority: "medium", downtime_minutes: 0, affected_seats: 1 });
      setMessage("Ticket raised successfully.");
      await loadTickets();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to raise ticket.");
    } finally {
      setTicketBusy(false);
    }
  };

  const submitComment = async () => {
    if (!selectedTicket || !commentText.trim()) return;
    setCommentBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/comments`, {
        text: commentText.trim(),
        is_internal: isAdminMode && internalNoteTab === "internal",
      });
      setCommentText("");
      await loadTicketDetail(selectedTicket.id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to add comment.");
    } finally {
      setCommentBusy(false);
    }
  };

  const doAssign = async () => {
    if (!selectedTicket || !assignToUserId) return;
    setAdminActionBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/assign`, { assigned_to: assignToUserId });
      setAssignToUserId("");
      setMessage("Ticket assigned.");
      await loadTicketDetail(selectedTicket.id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to assign.");
    } finally { setAdminActionBusy(false); }
  };

  const doTake = async () => {
    if (!selectedTicket) return;
    setAdminActionBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/take`, {});
      setMessage("Ticket taken.");
      await loadTicketDetail(selectedTicket.id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to take ticket.");
    } finally { setAdminActionBusy(false); }
  };

  const doHold = async () => {
    if (!selectedTicket || !holdReason.trim()) return;
    setAdminActionBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/hold`, { reason: holdReason.trim() });
      setHoldReason("");
      setShowHoldPanel(false);
      setMessage("Ticket put on hold.");
      await loadTicketDetail(selectedTicket.id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to hold ticket.");
    } finally { setAdminActionBusy(false); }
  };

  const doResolveAdmin = async () => {
    if (!selectedTicket || !resolveNote.trim()) return;
    setAdminActionBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/resolve`, {
        resolution_note: resolveNote.trim(),
        root_cause: resolveRootCause.trim() || undefined,
      });
      // Update IT-specific fields if changed
      const itUpdates: Record<string, unknown> = {};
      if (resolveSubcategory && resolveSubcategory !== selectedTicket.it_subcategory) itUpdates.it_subcategory = resolveSubcategory;
      if (resolveDowntime > 0 && resolveDowntime !== selectedTicket.downtime_minutes) itUpdates.downtime_minutes = resolveDowntime;
      if (Object.keys(itUpdates).length > 0) {
        await hrmsApi.patch(`/api/helpdesk/tickets/${selectedTicket.id}`, itUpdates);
      }
      setResolveNote("");
      setResolveRootCause("");
      setResolveDowntime(0);
      setResolveSubcategory("");
      setShowResolvePanel(false);
      setMessage("Ticket resolved.");
      await loadTicketDetail(selectedTicket.id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to resolve ticket.");
    } finally { setAdminActionBusy(false); }
  };

  const doEscalate = async () => {
    if (!selectedTicket) return;
    setAdminActionBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/escalate`, {});
      setMessage("Ticket escalated.");
      await loadTicketDetail(selectedTicket.id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to escalate.");
    } finally { setAdminActionBusy(false); }
  };

  const doChangePriority = async (priority: string) => {
    if (!selectedTicket) return;
    try {
      await hrmsApi.patch(`/api/helpdesk/tickets/${selectedTicket.id}`, { priority });
      await loadTicketDetail(selectedTicket.id);
    } catch { /* non-fatal */ }
  };

  const doReopen = async () => {
    if (!selectedTicket) return;
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/reopen`, {});
      setMessage("Ticket reopened.");
      await loadTicketDetail(selectedTicket.id);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to reopen.");
    }
  };

  const doRateCsat = async (rating: number) => {
    if (!selectedTicket || selectedTicket.closure_rating) return;
    setCsatBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${selectedTicket.id}/rating`, { rating });
      setCsatRating(rating);
      await loadTicketDetail(selectedTicket.id);
    } catch { /* non-fatal */ }
    finally { setCsatBusy(false); }
  };

  // ── Grievance actions ─────────────────────────────────────────────────────────

  const submitGrievance = async () => {
    if (!grievanceForm.subject.trim() || !grievanceForm.description.trim()) {
      return setMessage("Subject and description are required.");
    }
    setGrievanceBusy(true);
    try {
      await hrmsApi.post("/api/helpdesk/grievances", grievanceForm);
      setShowRaiseGrievance(false);
      setGrievanceForm({ subject: "", description: "", grievance_type: "workplace", severity: "medium", is_anonymous: false });
      setMessage("Grievance submitted.");
      await loadGrievances();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to submit grievance.");
    } finally {
      setGrievanceBusy(false);
    }
  };

  // ── KB actions ───────────────────────────────────────────────────────────────

  const handleKbSearch = (val: string) => {
    setKbSearch(val);
    if (kbSearchTimer.current) clearTimeout(kbSearchTimer.current);
    kbSearchTimer.current = setTimeout(() => void loadKbArticles(val), 350);
  };

  const voteKb = async (id: string, helpful: boolean) => {
    setKbVoteBusy(true);
    try {
      await hrmsApi.post(`/api/helpdesk/kb/${id}/helpful`, { is_helpful: helpful });
      if (selectedKbArticle?.id === id) await loadKbArticleDetail(id);
      else void loadKbArticles(kbSearch);
    } catch { /* non-fatal */ }
    finally { setKbVoteBusy(false); }
  };

  const submitKbArticle = async () => {
    if (!kbForm.title.trim() || !kbForm.content.trim()) {
      return setMessage("Title and content are required.");
    }
    setKbFormBusy(true);
    try {
      await hrmsApi.post("/api/helpdesk/kb", kbForm);
      setShowCreateKb(false);
      setKbForm({ title: "", category: "it", it_subcategory: "", content: "", tags: "", status: "published" });
      setMessage("Article published.");
      void loadKbArticles(kbSearch);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to publish article.");
    } finally { setKbFormBusy(false); }
  };

  // ── Filtered ─────────────────────────────────────────────────────────────────

  const filteredTickets = tickets.filter((t) => {
    const q = ticketSearch.trim().toLowerCase();
    const statusMatch = statusFilter === "all" || t.status === statusFilter;
    // t.assigned_to is auth_user.id (helpdesk.service.ts's TICKET_SELECT joins
    // auth_user u ON u.id = t.assigned_to; /take assigns req.authUser.id into this same
    // column) — this used to only check "is assigned to *someone*", so "My Tickets"
    // showed every agent's queue combined, not the caller's own. An agent had no way to
    // see just what was actually theirs to work.
    const assignedMatch = !myTicketsOnly || t.assigned_to === user?.id;
    const text = [t.subject, t.category, t.it_subcategory, t.status, t.priority, t.ticket_number, t.ticket_code, t.full_name, t.branch_name].join(" ").toLowerCase();
    return statusMatch && assignedMatch && (!q || text.includes(q));
  });

  const subLabel = ALL_SUBCATEGORIES.find(s => s.value === selectedTicket?.it_subcategory)?.label;
  const isItTicket = selectedTicket?.category?.toLowerCase() === "it";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Support</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Helpdesk</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Raise and track support tickets, submit grievances, or browse the knowledge base.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void (tab === "tickets" ? loadTickets() : tab === "grievances" ? loadGrievances() : loadKbArticles(kbSearch))}
              className={btnSecondary}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            {tab === "tickets" && (
              <button onClick={() => { setShowRaiseTicket(true); setMessage(""); }} className={btnPrimary}>
                <Plus className="h-4 w-4" /> Raise Ticket
              </button>
            )}
            {tab === "grievances" && (
              <button onClick={() => { setShowRaiseGrievance(true); setMessage(""); }} className={btnPrimary}>
                <Plus className="h-4 w-4" /> Raise Grievance
              </button>
            )}
            {tab === "kb" && isAdminMode && (
              <button onClick={() => { setShowCreateKb(true); setMessage(""); }} className={btnPrimary}>
                <Plus className="h-4 w-4" /> New Article
              </button>
            )}
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
            <button onClick={() => setMessage("")} className="ml-auto cursor-pointer"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-1 rounded-2xl border bg-slate-50 p-1 w-fit">
          {(["tickets", "grievances", "kb"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSelectedTicket(null); setSelectedKbArticle(null); setMessage(""); }}
              className={`rounded-xl px-5 py-2 text-sm font-bold cursor-pointer transition-colors ${tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {t === "kb" ? "Knowledge Base" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            TICKET DETAIL VIEW
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === "tickets" && selectedTicket ? (
          <div className="space-y-4">
            <button onClick={() => setSelectedTicket(null)} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back to Tickets
            </button>

            {ticketDetailLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Main ticket card */}
                <div className="lg:col-span-2 rounded-3xl border bg-white shadow-sm">
                  {/* Header */}
                  <div className="border-b p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {(selectedTicket.ticket_number || selectedTicket.ticket_code) && (
                            <span className="font-mono text-xs font-bold text-slate-400">
                              #{selectedTicket.ticket_number ?? selectedTicket.ticket_code}
                            </span>
                          )}
                          <PriorityBadge priority={selectedTicket.priority} />
                          <StatusBadge status={selectedTicket.status} />
                          <SlaBadge sla_due_at={selectedTicket.sla_due_at} sla_breached={!!selectedTicket.sla_breached} status={selectedTicket.status} />
                          {selectedTicket.escalation_level ? (
                            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-orange-50 text-orange-700">
                              Escalated L{selectedTicket.escalation_level}
                            </span>
                          ) : null}
                        </div>
                        <h2 className="text-xl font-black text-slate-950">{selectedTicket.subject}</h2>

                        {/* Metadata grid */}
                        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div><span className="text-slate-400 font-semibold uppercase tracking-wide">Category</span><div className="font-semibold text-slate-700 mt-0.5">{selectedTicket.category}</div></div>
                          {subLabel && <div><span className="text-slate-400 font-semibold uppercase tracking-wide">Sub-Category</span><div className="font-semibold text-slate-700 mt-0.5">{subLabel}</div></div>}
                          <div><span className="text-slate-400 font-semibold uppercase tracking-wide">Raised On</span><div className="font-semibold text-slate-700 mt-0.5">{formatISTDate(selectedTicket.created_at)}</div></div>
                          <div><span className="text-slate-400 font-semibold uppercase tracking-wide">Assigned To</span><div className="font-semibold text-slate-700 mt-0.5">{selectedTicket.assigned_name ?? <span className="text-slate-400">Unassigned</span>}</div></div>
                          {selectedTicket.full_name && <div><span className="text-slate-400 font-semibold uppercase tracking-wide">Raised By</span><div className="font-semibold text-slate-700 mt-0.5">{selectedTicket.full_name}{selectedTicket.employee_code ? ` (${selectedTicket.employee_code})` : ""}</div></div>}
                          {selectedTicket.branch_name && <div><span className="text-slate-400 font-semibold uppercase tracking-wide">Branch / Process</span><div className="font-semibold text-slate-700 mt-0.5">{selectedTicket.branch_name}{selectedTicket.process_name ? ` · ${selectedTicket.process_name}` : ""}</div></div>}
                          {isItTicket && <div><span className="text-slate-400 font-semibold uppercase tracking-wide">Downtime</span><div className="font-semibold text-slate-700 mt-0.5">{selectedTicket.downtime_minutes ?? 0} min</div></div>}
                          {isItTicket && <div><span className="text-slate-400 font-semibold uppercase tracking-wide">Affected Seats</span><div className="font-semibold text-slate-700 mt-0.5">{selectedTicket.affected_seats ?? 1}</div></div>}
                        </div>

                        {selectedTicket.status === "on_hold" && selectedTicket.hold_reason && (
                          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 font-semibold">
                            On Hold: {selectedTicket.hold_reason}
                          </div>
                        )}
                      </div>
                      {["resolved", "closed"].includes(selectedTicket.status) && (
                        <button onClick={() => void doReopen()} className={btnSecondary}>
                          <RefreshCcw className="h-4 w-4" /> Reopen
                        </button>
                      )}
                    </div>
                    <p className="mt-4 text-sm text-slate-700 leading-relaxed">{selectedTicket.description}</p>
                  </div>

                  {/* CSAT rating — employee view only, resolved tickets */}
                  {selectedTicket.status === "resolved" && !isAdminMode && (
                    <div className="border-b px-6 py-4 bg-slate-50">
                      <p className="text-sm font-bold text-slate-700 mb-2">Rate this resolution</p>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(star => (
                          <button
                            key={star}
                            onClick={() => void doRateCsat(star)}
                            disabled={csatBusy || !!selectedTicket.closure_rating}
                            className="cursor-pointer text-2xl transition-colors disabled:cursor-default"
                          >
                            <Star
                              className={`h-6 w-6 ${(csatRating || (selectedTicket.closure_rating ?? 0)) >= star ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
                            />
                          </button>
                        ))}
                      </div>
                      {selectedTicket.closure_rating && (
                        <p className="text-xs text-slate-400 mt-1">You rated this {selectedTicket.closure_rating}/5</p>
                      )}
                    </div>
                  )}

                  {/* Comments */}
                  <div className="p-6 space-y-4">
                    <h3 className="font-black text-slate-950">Comments ({selectedTicket.comments?.length ?? 0})</h3>
                    {(selectedTicket.comments ?? []).length === 0 ? (
                      <p className="text-sm text-slate-400">No comments yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {(selectedTicket.comments ?? []).map((c) => (
                          <div key={c.id} className={`rounded-2xl p-4 text-sm ${c.is_internal ? "bg-amber-50 border border-amber-100" : "bg-slate-50"}`}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-bold text-slate-800">{c.author_name ?? "Agent"}</span>
                              <div className="flex items-center gap-2">
                                {c.is_internal && (
                                  <span className="text-xs font-semibold text-amber-600 flex items-center gap-1">
                                    <EyeOff className="h-3 w-3" /> Internal
                                  </span>
                                )}
                                <span className="text-xs text-slate-400 font-mono">{formatIST(c.created_at)}</span>
                              </div>
                            </div>
                            <p className="text-slate-700">{c.text}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add comment / internal note */}
                    <div className="rounded-2xl border p-4 space-y-3">
                      {isAdminMode && (
                        <div className="flex gap-1 rounded-xl border bg-slate-50 p-1 w-fit">
                          {(["public", "internal"] as const).map(t => (
                            <button
                              key={t}
                              onClick={() => setInternalNoteTab(t)}
                              className={`rounded-lg px-4 py-1.5 text-xs font-bold cursor-pointer transition-colors ${internalNoteTab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                            >
                              {t === "internal" ? "Internal Note" : "Public Comment"}
                            </button>
                          ))}
                        </div>
                      )}
                      <h4 className="font-bold text-slate-800 text-sm">
                        {isAdminMode && internalNoteTab === "internal" ? "Add Internal Note" : "Add Comment"}
                      </h4>
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        rows={3}
                        placeholder={isAdminMode && internalNoteTab === "internal" ? "Internal note (not visible to employee)…" : "Write your comment…"}
                        className={`${inputCls} resize-none`}
                      />
                      <button
                        onClick={() => void submitComment()}
                        disabled={commentBusy || !commentText.trim()}
                        className={btnPrimary}
                      >
                        <MessageSquare className="h-4 w-4" />
                        {commentBusy ? "Posting…" : "Post"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Admin action panel */}
                {isAdminMode && (
                  <div className="space-y-4">
                    <div className="rounded-3xl border bg-white shadow-sm p-5 space-y-4">
                      <h3 className="font-black text-slate-950 text-sm">Admin Actions</h3>

                      {/* Assign + Take */}
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Assign To</label>
                        <select
                          value={assignToUserId}
                          onChange={e => setAssignToUserId(e.target.value)}
                          className={inputCls}
                        >
                          <option value="">— Select agent —</option>
                          {agents.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.full_name}{a.branch_name ? ` (${a.branch_name})` : ""}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            onClick={() => void doAssign()}
                            disabled={!assignToUserId || adminActionBusy}
                            className={`${btnPrimary} flex-1 justify-center`}
                          >
                            Assign
                          </button>
                          <button
                            onClick={() => void doTake()}
                            disabled={adminActionBusy}
                            className={`${btnSecondary} flex-1 justify-center`}
                          >
                            Take
                          </button>
                        </div>
                      </div>

                      {/* Priority */}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Priority</label>
                        <select
                          value={selectedTicket.priority}
                          onChange={e => void doChangePriority(e.target.value)}
                          className={inputCls}
                        >
                          {["low", "medium", "high", "urgent"].map(p => (
                            <option key={p} value={p} className="capitalize">{p}</option>
                          ))}
                        </select>
                      </div>

                      {/* IT-specific inline controls */}
                      {isItTicket && (
                        <div className="space-y-2 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                          <label className="text-xs font-semibold text-blue-700 uppercase tracking-wide">IT Details</label>
                          <div className="space-y-1.5">
                            <label className="text-xs text-slate-500">Sub-Category</label>
                            <select
                              defaultValue={selectedTicket.it_subcategory ?? ""}
                              onChange={async e => {
                                if (selectedTicket) {
                                  await hrmsApi.patch(`/api/helpdesk/tickets/${selectedTicket.id}`, { it_subcategory: e.target.value || null });
                                  await loadTicketDetail(selectedTicket.id);
                                }
                              }}
                              className={`${inputCls} bg-white`}
                            >
                              <option value="">— None —</option>
                              {BPO_IT_SUBCATEGORIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-slate-500">Downtime (min)</label>
                              <input
                                type="number" min={0}
                                defaultValue={selectedTicket.downtime_minutes ?? 0}
                                onBlur={async e => {
                                  const val = Math.max(0, Number(e.target.value));
                                  if (val !== (selectedTicket.downtime_minutes ?? 0)) {
                                    await hrmsApi.patch(`/api/helpdesk/tickets/${selectedTicket.id}`, { downtime_minutes: val });
                                    await loadTicketDetail(selectedTicket.id);
                                  }
                                }}
                                className={`${inputCls} bg-white`}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">Affected Seats</label>
                              <input
                                type="number" min={1}
                                defaultValue={selectedTicket.affected_seats ?? 1}
                                onBlur={async e => {
                                  const val = Math.max(1, Number(e.target.value));
                                  if (val !== (selectedTicket.affected_seats ?? 1)) {
                                    await hrmsApi.patch(`/api/helpdesk/tickets/${selectedTicket.id}`, { affected_seats: val });
                                    await loadTicketDetail(selectedTicket.id);
                                  }
                                }}
                                className={`${inputCls} bg-white`}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</label>

                        {/* Escalate */}
                        {!["resolved", "closed", "cancelled"].includes(selectedTicket.status) && (
                          <button
                            onClick={() => void doEscalate()}
                            disabled={adminActionBusy}
                            className="w-full rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-bold text-orange-700 hover:bg-orange-100 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Escalate (L{(selectedTicket.escalation_level ?? 0) + 1})
                          </button>
                        )}

                        {/* On Hold toggle */}
                        {!["resolved", "closed", "cancelled", "on_hold"].includes(selectedTicket.status) && (
                          <button
                            onClick={() => { setShowHoldPanel(p => !p); setShowResolvePanel(false); }}
                            className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
                          >
                            Put On Hold <ChevronDown className="inline h-3 w-3 ml-1" />
                          </button>
                        )}
                        {showHoldPanel && (
                          <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                            <textarea
                              value={holdReason}
                              onChange={e => setHoldReason(e.target.value)}
                              rows={2}
                              placeholder="Reason (vendor pending, awaiting parts…)"
                              className={`${inputCls} resize-none bg-white`}
                            />
                            <button
                              onClick={() => void doHold()}
                              disabled={!holdReason.trim() || adminActionBusy}
                              className="rounded-2xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              Confirm Hold
                            </button>
                          </div>
                        )}

                        {/* Resolve toggle */}
                        {!["resolved", "closed", "cancelled"].includes(selectedTicket.status) && (
                          <button
                            onClick={() => { setShowResolvePanel(p => !p); setShowHoldPanel(false); }}
                            className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                          >
                            Resolve <ChevronDown className="inline h-3 w-3 ml-1" />
                          </button>
                        )}
                        {showResolvePanel && (
                          <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                            <input
                              value={resolveNote}
                              onChange={e => setResolveNote(e.target.value)}
                              placeholder="Resolution note *"
                              className={`${inputCls} bg-white`}
                            />
                            <input
                              value={resolveRootCause}
                              onChange={e => setResolveRootCause(e.target.value)}
                              placeholder="Root cause (optional)"
                              className={`${inputCls} bg-white`}
                            />
                            {isItTicket && (
                              <>
                                <select
                                  value={resolveSubcategory || selectedTicket.it_subcategory || ""}
                                  onChange={e => setResolveSubcategory(e.target.value)}
                                  className={`${inputCls} bg-white`}
                                >
                                  <option value="">— IT Sub-Category (confirm/correct) —</option>
                                  {BPO_IT_SUBCATEGORIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                                <input
                                  type="number" min={0}
                                  value={resolveDowntime || selectedTicket.downtime_minutes || 0}
                                  onChange={e => setResolveDowntime(Math.max(0, Number(e.target.value)))}
                                  placeholder="Final downtime (min)"
                                  className={`${inputCls} bg-white`}
                                />
                              </>
                            )}
                            <button
                              onClick={() => void doResolveAdmin()}
                              disabled={!resolveNote.trim() || adminActionBusy}
                              className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              Mark Resolved
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        ) : tab === "tickets" ? (
          /* ═════════════════════════════════════════════════════════════════════
              TICKET LIST
          ═════════════════════════════════════════════════════════════════════ */
          <div className="space-y-4">
            {/* Status filter pills + My Tickets toggle */}
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTER_TABS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setStatusFilter(s.key)}
                  className={`rounded-xl px-4 py-1.5 text-xs font-bold cursor-pointer transition-colors ${statusFilter === s.key ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  {s.label}
                </button>
              ))}
              {isAdminMode && (
                <button
                  onClick={() => setMyTicketsOnly(p => !p)}
                  className={`ml-2 rounded-xl px-4 py-1.5 text-xs font-bold cursor-pointer transition-colors ${myTicketsOnly ? "bg-blue-600 text-white" : "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
                >
                  My Tickets
                </button>
              )}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                placeholder="Search subject, category, status…"
                className="h-11 w-full rounded-2xl border bg-white pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors shadow-sm"
              />
            </div>

            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Support Tickets</h2>
                <p className="text-sm text-slate-500">{filteredTickets.length} tickets</p>
              </div>
              {ticketsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No tickets found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Ticket", "Category", "Priority", "Status", "SLA", "Assigned To", "Raised On", ""].map((h) => (
                          <th key={h} className="p-4 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTickets.map((t) => (
                        <tr
                          key={t.id}
                          onClick={() => { void loadTicketDetail(t.id); }}
                          className="border-t hover:bg-slate-50/80 transition-colors cursor-pointer"
                        >
                          <td className="p-4">
                            <div className="font-semibold text-slate-900">{t.subject}</div>
                            {(t.ticket_number || t.ticket_code) && (
                              <div className="font-mono text-xs text-slate-400">#{t.ticket_number ?? t.ticket_code}</div>
                            )}
                          </td>
                          <td className="p-4 text-slate-600">
                            <div>{t.category}</div>
                            {t.it_subcategory && (
                              <div className="text-xs text-slate-400">
                                {ALL_SUBCATEGORIES.find(s => s.value === t.it_subcategory)?.label ?? t.it_subcategory}
                              </div>
                            )}
                          </td>
                          <td className="p-4"><PriorityBadge priority={t.priority} /></td>
                          <td className="p-4"><StatusBadge status={t.status} /></td>
                          <td className="p-4">
                            <SlaBadge sla_due_at={t.sla_due_at} sla_breached={!!t.sla_breached} status={t.status} />
                          </td>
                          <td className="p-4 text-slate-500">{t.assigned_name ?? "–"}</td>
                          <td className="p-4 font-mono text-xs text-slate-400">{formatISTDate(t.created_at)}</td>
                          <td className="p-4 text-blue-600 text-xs font-bold">View →</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        ) : tab === "grievances" ? (
          /* ═════════════════════════════════════════════════════════════════════
              GRIEVANCES LIST
          ═════════════════════════════════════════════════════════════════════ */
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-black text-slate-950">Grievances</h2>
              <p className="text-sm text-slate-500">{grievances.length} submitted</p>
            </div>
            {grievancesLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : grievances.length === 0 ? (
              <div className="py-16 text-center text-slate-400">
                <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="font-semibold">No grievances found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Subject", "Type", "Severity", "Status", "Anonymous", "Submitted On"].map((h) => (
                        <th key={h} className="p-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grievances.map((g) => (
                      <tr key={g.id} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4">
                          <div className="font-semibold text-slate-900">{g.subject}</div>
                          <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{g.description}</div>
                        </td>
                        <td className="p-4 text-slate-600 capitalize">{g.grievance_type.replace(/_/g, " ")}</td>
                        <td className="p-4">
                          {g.severity && <span className="capitalize text-xs text-slate-600">{g.severity}</span>}
                        </td>
                        <td className="p-4"><StatusBadge status={g.status} /></td>
                        <td className="p-4">
                          {g.is_anonymous ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                              <EyeOff className="h-3 w-3" /> Anonymous
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">Named</span>
                          )}
                        </td>
                        <td className="p-4 font-mono text-xs text-slate-400">{formatISTDate(g.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        ) : (
          /* ═════════════════════════════════════════════════════════════════════
              KNOWLEDGE BASE
          ═════════════════════════════════════════════════════════════════════ */
          <div className="space-y-4">
            {selectedKbArticle ? (
              /* Article detail */
              <div className="space-y-4">
                <button onClick={() => setSelectedKbArticle(null)} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
                  <ArrowLeft className="h-4 w-4" /> Back to Articles
                </button>
                <div className="rounded-3xl border bg-white shadow-sm p-6 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 capitalize">{selectedKbArticle.category}</span>
                    {selectedKbArticle.it_subcategory && (
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600">
                        {ALL_SUBCATEGORIES.find(s => s.value === selectedKbArticle.it_subcategory)?.label ?? selectedKbArticle.it_subcategory}
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl font-black text-slate-950">{selectedKbArticle.title}</h2>
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span>{selectedKbArticle.view_count} views</span>
                    <span>{selectedKbArticle.helpful_count} found helpful</span>
                    {selectedKbArticle.author_name && <span>by {selectedKbArticle.author_name}</span>}
                  </div>
                  <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap leading-relaxed border-t pt-4">
                    {selectedKbArticle.content}
                  </div>
                  {selectedKbArticle.tags && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {selectedKbArticle.tags.split(",").map(tag => tag.trim()).filter(Boolean).map(tag => (
                        <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="border-t pt-4">
                    <p className="text-sm font-semibold text-slate-700 mb-2">Was this helpful?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void voteKb(selectedKbArticle.id, true)}
                        disabled={kbVoteBusy}
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 cursor-pointer transition-colors disabled:opacity-50"
                      >
                        <ThumbsUp className="h-4 w-4" /> Yes ({selectedKbArticle.helpful_count})
                      </button>
                      <button
                        onClick={() => void voteKb(selectedKbArticle.id, false)}
                        disabled={kbVoteBusy}
                        className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors disabled:opacity-50"
                      >
                        <ThumbsDown className="h-4 w-4" /> No ({selectedKbArticle.not_helpful_count})
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Article list */
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={kbSearch}
                    onChange={(e) => handleKbSearch(e.target.value)}
                    placeholder="Search knowledge base…"
                    className="h-11 w-full rounded-2xl border bg-white pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors shadow-sm"
                  />
                </div>
                {kbLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
                ) : kbArticles.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">
                    <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-30" />
                    <p className="font-semibold">No articles found.</p>
                    {isAdminMode && (
                      <button onClick={() => setShowCreateKb(true)} className={`${btnPrimary} mt-4 mx-auto`}>
                        <Plus className="h-4 w-4" /> Create First Article
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {kbArticles.map(a => (
                      <div
                        key={a.id}
                        onClick={() => void loadKbArticleDetail(a.id)}
                        className="rounded-3xl border bg-white p-5 cursor-pointer hover:shadow-md transition-shadow space-y-2"
                      >
                        <div className="flex flex-wrap gap-1.5">
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 capitalize">{a.category}</span>
                          {a.it_subcategory && (
                            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600">
                              {ALL_SUBCATEGORIES.find(s => s.value === a.it_subcategory)?.label ?? a.it_subcategory}
                            </span>
                          )}
                        </div>
                        <h3 className="font-black text-slate-950 text-sm leading-snug line-clamp-2">{a.title}</h3>
                        {a.tags && (
                          <p className="text-xs text-slate-400 line-clamp-1">{a.tags}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-slate-400 pt-1">
                          <span>{a.view_count} views</span>
                          <span className="flex items-center gap-0.5"><ThumbsUp className="h-3 w-3" /> {a.helpful_count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Raise Ticket Modal ────────────────────────────────────────────────── */}
      {showRaiseTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Raise Support Ticket</h2>
              <button onClick={() => setShowRaiseTicket(false)} className="cursor-pointer text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select
                    value={ticketForm.category}
                    onChange={(e) => setTicketForm({ ...ticketForm, category: e.target.value, it_subcategory: "" })}
                    className={inputCls}
                  >
                    {["IT", "HR", "Payroll", "Admin", "Asset", "Leave", "Attendance", "Other"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={ticketForm.priority} onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })} className={inputCls}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </Field>
              </div>

              <Field label="Sub-Category">
                <select
                  value={ticketForm.it_subcategory}
                  onChange={(e) => setTicketForm({ ...ticketForm, it_subcategory: e.target.value })}
                  className={inputCls}
                >
                  <option value="">— Select sub-category —</option>
                  {subcategoriesFor(ticketForm.category).map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </Field>
              {ticketForm.category.toLowerCase() === "it" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Agent Downtime (min)">
                    <input
                      type="number"
                      min={0}
                      value={ticketForm.downtime_minutes}
                      onChange={(e) => setTicketForm({ ...ticketForm, downtime_minutes: Math.max(0, Number(e.target.value)) })}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Affected Seats">
                    <input
                      type="number"
                      min={1}
                      value={ticketForm.affected_seats}
                      onChange={(e) => setTicketForm({ ...ticketForm, affected_seats: Math.max(1, Number(e.target.value)) })}
                      className={inputCls}
                    />
                  </Field>
                </div>
              )}

              <Field label="Subject *">
                <input value={ticketForm.subject} onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })} placeholder="Brief summary of the issue" className={inputCls} />
              </Field>
              <Field label="Description *">
                <textarea value={ticketForm.description} onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })} rows={4} placeholder="Describe the issue in detail…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowRaiseTicket(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={() => void submitTicket()} disabled={ticketBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {ticketBusy ? "Submitting…" : "Submit Ticket"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Raise Grievance Modal ─────────────────────────────────────────────── */}
      {showRaiseGrievance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Submit Grievance</h2>
              <button onClick={() => setShowRaiseGrievance(false)} className="cursor-pointer text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select value={grievanceForm.grievance_type} onChange={(e) => setGrievanceForm({ ...grievanceForm, grievance_type: e.target.value })} className={inputCls}>
                    {["workplace", "harassment", "discrimination", "policy", "compensation", "safety", "other"].map((t) => (
                      <option key={t} value={t} className="capitalize">{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Severity">
                  <select value={grievanceForm.severity} onChange={(e) => setGrievanceForm({ ...grievanceForm, severity: e.target.value })} className={inputCls}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={grievanceForm.is_anonymous}
                  onChange={(e) => setGrievanceForm({ ...grievanceForm, is_anonymous: e.target.checked })}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm text-slate-700 font-semibold">Submit anonymously</span>
              </label>
              <Field label="Subject *">
                <input value={grievanceForm.subject} onChange={(e) => setGrievanceForm({ ...grievanceForm, subject: e.target.value })} placeholder="Brief subject" className={inputCls} />
              </Field>
              <Field label="Description *">
                <textarea value={grievanceForm.description} onChange={(e) => setGrievanceForm({ ...grievanceForm, description: e.target.value })} rows={4} placeholder="Describe your grievance…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowRaiseGrievance(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={() => void submitGrievance()} disabled={grievanceBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {grievanceBusy ? "Submitting…" : "Submit Grievance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create KB Article Modal ───────────────────────────────────────────── */}
      {showCreateKb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">New KB Article</h2>
              <button onClick={() => setShowCreateKb(false)} className="cursor-pointer text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Title *">
                <input value={kbForm.title} onChange={e => setKbForm({ ...kbForm, title: e.target.value })} placeholder="Article title" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select value={kbForm.category} onChange={e => setKbForm({ ...kbForm, category: e.target.value, it_subcategory: "" })} className={inputCls}>
                    {["it", "hr", "payroll", "admin", "asset", "attendance", "leave", "general", "other"].map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                  </select>
                </Field>
                <Field label="Sub-Category">
                  <select value={kbForm.it_subcategory} onChange={e => setKbForm({ ...kbForm, it_subcategory: e.target.value })} className={inputCls}>
                    <option value="">— None —</option>
                    {subcategoriesFor(kbForm.category).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Tags (comma-separated)">
                <input value={kbForm.tags} onChange={e => setKbForm({ ...kbForm, tags: e.target.value })} placeholder="dialer, softphone, cisco" className={inputCls} />
              </Field>
              <Field label="Content *">
                <textarea value={kbForm.content} onChange={e => setKbForm({ ...kbForm, content: e.target.value })} rows={8} placeholder="Step-by-step solution or guidance…" className={`${inputCls} resize-none font-mono text-xs`} />
              </Field>
              <Field label="Status">
                <select value={kbForm.status} onChange={e => setKbForm({ ...kbForm, status: e.target.value })} className={inputCls}>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowCreateKb(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={() => void submitKbArticle()} disabled={kbFormBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {kbFormBusy ? "Publishing…" : "Publish Article"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
