import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useGeoCapture } from "@/hooks/useGeoCapture";
import { useDebounce } from "@/hooks/useDebounce";
import { useSearchParams } from "react-router-dom";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge as SmartHRStatusBadge, normalizeStatus } from "@/components/ui/status-badge"; // kept for stage badges in DetailDialog
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Layers,
  Loader2,
  RefreshCw,
  Send,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type RequestStatus =
  | "submitted"
  | "pending_manager"
  | "pending_admin"
  | "approved"
  | "rejected"
  | "cancelled";

type RegularizationDetail = {
  id: string;
  request_id: string;
  attendance_date: string;
  current_status: string | null;
  current_login_time: string | null;
  current_logout_time: string | null;
  requested_login_time: string | null;
  requested_logout_time: string | null;
  attendance_source: string | null;
  payroll_impact_required: boolean;
  created_at: string;
  updated_at: string;
};

type ApprovalStage = {
  id: string;
  request_id: string;
  stage_no: number;
  stage_name: string;
  approver_role: string | null;
  status: string;
  remarks: string | null;
  assigned_at: string;
  acted_at: string | null;
};

type ActionLog = {
  id: string;
  request_id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  remarks: string | null;
  created_at: string;
};

type EmployeeRequest = {
  id: string;
  request_no: string;
  employee_id: string | null;
  submitted_by: string | null;
  request_type_code: string;
  title: string;
  reason: string | null;
  current_status: RequestStatus;
  current_stage_no: number;
  current_stage_name: string | null;
  current_owner_role: string | null;
  source_module: string | null;
  source_date: string | null;
  payroll_impact_status: string;
  submitted_at: string | null;
  final_decision_at: string | null;
  created_at: string;
  regularization_request_detail?: RegularizationDetail[];
  request_approval_stage?: ApprovalStage[];
  request_action_log?: ActionLog[];
  raw_status?: string;
  decision_support?: RegularizationDecisionSupport;
};

type RegularizationDecisionSupport = {
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  flags: string[];
  canBulkApprove: boolean;
  evidence: {
    currentAttendanceStatus: string | null;
    currentLwp: number | string | null;
    firstPunch: string | null;
    lastPunch: string | null;
    totalPunches: number;
    biometricMinutes: number | string | null;
    rawMinutes: number | string | null;
    rosterStatus: string | null;
    rosterShiftStart: string | null;
    rosterShiftEnd: string | null;
    duplicateRequests: number;
    recentRequests: number;
  };
};

type WfmRegularizationRow = {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  employee_code?: string | null;
  session_date: string;
  status: string;
  requested_status?: string | null;
  reason?: string | null;
  reason_label?: string | null;
  old_status?: string | null;
  old_punch_in?: string | null;
  old_punch_out?: string | null;
  new_punch_in?: string | null;
  new_punch_out?: string | null;
  reviewer_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at?: string;
  decision_support?: RegularizationDecisionSupport;
};

type AttendancePreview = {
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  attendanceDate: string;
  currentStatus: string;
  currentLoginTime: string | null;
  currentLogoutTime: string | null;
  suggestedLoginTime: string | null;
  suggestedLogoutTime: string | null;
  attendanceSource: string;
  biometricMinutes: number;
  rawMinutes: number;
  lwpValue: number;
  totalPunches: number;
  punches: Array<{
    punchTime: string;
    ioLabel: string;
    deviceId: string | null;
  }>;
};

type ApiErrorLike = {
  response?: { data?: { error?: string; message?: string } };
  message?: string;
};

type BulkReviewResponse = {
  data?: {
    succeeded?: number;
    failed?: number;
    data?: Array<{ success?: boolean; message?: string; id?: string }>;
  };
};

type DateRangeDay = {
  date: string;
  currentStatus: string;
  loginTime: string | null;
  logoutTime: string | null;
  lwpValue: number;
  hasRecord: boolean;
  alreadyRequested: boolean;
  selectable: boolean;
};

type DateRangePreview = {
  employeeId: string;
  fromDate: string;
  toDate: string;
  days: DateRangeDay[];
};

type BatchSubmitResult = {
  data?: {
    succeeded?: number;
    failed?: number;
    data?: Array<{ date: string; success: boolean; id?: string; message?: string }>;
  };
};

// ── Request type classification ───────────────────────────────────────────

type RequestCategory = "punch_correction" | "status_change" | "exception";

const EXCEPTION_DISPUTE_TYPES = new Set(["week_off_worked", "holiday_worked"]);

const REQUEST_CATEGORIES: Array<{
  value: RequestCategory;
  label: string;
  icon: ReactNode;
  description: string;
  hint: string;
}> = [
  {
    value: "punch_correction",
    label: "Punch Correction",
    icon: <Clock className="h-4 w-4" />,
    description: "Fix wrong/missing login or logout time",
    hint: "Use when biometric device missed your punch or recorded wrong time.",
  },
  {
    value: "status_change",
    label: "Status Change",
    icon: <ClipboardList className="h-4 w-4" />,
    description: "Change attendance status (absent → present, etc.)",
    hint: "Use when your attendance status is incorrect and needs correction.",
  },
  {
    value: "exception",
    label: "Exception Request",
    icon: <Zap className="h-4 w-4" />,
    description: "Worked on week-off or holiday — request pay/comp-off",
    hint: "Use when you worked on a scheduled week-off or public holiday.",
  },
];

const PUNCH_DISPUTE_TYPES = [
  { value: "missing_punch", label: "Missing Punch" },
  { value: "wrong_punch", label: "Wrong Punch" },
  { value: "late_mark_dispute", label: "Late Mark Dispute" },
  { value: "early_logout_dispute", label: "Early Logout Dispute" },
  { value: "cosec_sync_issue", label: "CosEC Sync Issue" },
  { value: "manual_punch_correction", label: "Manual Punch Correction" },
];

const STATUS_DISPUTE_TYPES = [
  { value: "half_day_dispute", label: "Half Day Dispute" },
  { value: "absent_wrongly_marked", label: "Absent Wrongly Marked" },
  { value: "shift_mismatch", label: "Shift Mismatch" },
];

const EXCEPTION_TYPES = [
  { value: "week_off_worked", label: "Week-Off Worked" },
  { value: "holiday_worked", label: "Holiday Worked" },
  { value: "work_from_home", label: "Work from Home" },
];

function disputeTypesForCategory(cat: RequestCategory) {
  if (cat === "punch_correction") return PUNCH_DISPUTE_TYPES;
  if (cat === "status_change") return STATUS_DISPUTE_TYPES;
  return EXCEPTION_TYPES;
}

// ── Constants ─────────────────────────────────────────────────────────────

const statusLabel: Record<string, string> = {
  submitted: "Submitted",
  pending_manager: "Pending Manager",
  pending_admin: "Pending WFM / Admin",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function normalizeRegularizationStatus(status: string): RequestStatus {
  if (status === "pending") return "pending_manager";
  if (status === "manager_approved") return "pending_admin";
  if (["approved", "rejected", "cancelled"].includes(status)) return status as RequestStatus;
  return "submitted";
}

function normalizeRegularizationRow(row: WfmRegularizationRow): EmployeeRequest {
  const attendanceDate = String(row.session_date ?? "").slice(0, 10);
  const disputeType = (row as any).dispute_type ?? null;
  const requestTypeCode = EXCEPTION_DISPUTE_TYPES.has(disputeType ?? "")
    ? "exception"
    : "attendance_regularization";

  return {
    id: row.id,
    request_id: row.id,
    request_no: `${row.employee_code ?? "REG"}-${attendanceDate || row.id.slice(0, 8)}`,
    employee_id: row.employee_id,
    submitted_by: row.employee_name ?? row.employee_code ?? null,
    request_type_code: requestTypeCode,
    title: requestTypeCode === "exception"
      ? `Exception (${disputeType}) for ${attendanceDate}`
      : `Attendance regularization for ${attendanceDate || "selected date"}`,
    reason: row.reason_label ?? row.reason ?? null,
    current_status: normalizeRegularizationStatus(row.status),
    raw_status: row.status,
    current_stage_no: row.status === "manager_approved" ? 2 : 1,
    current_stage_name: row.status === "manager_approved" ? "WFM final review" : "Manager review",
    current_owner_role: row.status === "manager_approved" ? "Branch WFM" : "Reporting Manager",
    source_module: "wfm",
    source_date: attendanceDate,
    payroll_impact_status: row.status === "approved" ? "locked" : "pending",
    submitted_at: row.created_at,
    final_decision_at: row.reviewed_at ?? null,
    created_at: row.created_at,
    decision_support: row.decision_support,
    regularization_request_detail: [{
      id: row.id,
      request_id: row.id,
      attendance_date: attendanceDate,
      current_status: row.old_status ?? row.decision_support?.evidence.currentAttendanceStatus ?? null,
      current_login_time: row.old_punch_in ?? row.decision_support?.evidence.firstPunch ?? null,
      current_logout_time: row.old_punch_out ?? row.decision_support?.evidence.lastPunch ?? null,
      requested_login_time: row.new_punch_in ?? null,
      requested_logout_time: row.new_punch_out ?? null,
      attendance_source: "wfm",
      payroll_impact_required: row.status === "approved",
      created_at: row.created_at,
      updated_at: row.updated_at ?? row.created_at,
    }],
    request_approval_stage: [
      {
        id: `${row.id}-manager`,
        request_id: row.id,
        stage_no: 1,
        stage_name: "Manager Review",
        approver_role: "Reporting Manager",
        status: row.status === "pending" ? "pending_manager" : "approved",
        remarks: null,
        assigned_at: row.created_at,
        acted_at: row.status !== "pending" ? row.reviewed_at ?? null : null,
      },
      {
        id: `${row.id}-wfm`,
        request_id: row.id,
        stage_no: 2,
        stage_name: "Branch WFM Validation",
        approver_role: "Branch WFM",
        status: row.status === "manager_approved" ? "pending_admin" : row.status === "approved" ? "approved" : row.status === "rejected" ? "rejected" : "submitted",
        remarks: row.reviewer_note ?? null,
        assigned_at: row.created_at,
        acted_at: row.status === "approved" || row.status === "rejected" ? row.reviewed_at ?? null : null,
      },
    ],
    request_action_log: [],
  };
}

function getApiErrorMessage(error: unknown, fallback: string) {
  const typedError = error as ApiErrorLike;
  return (
    typedError?.response?.data?.error ??
    typedError?.response?.data?.message ??
    typedError?.message ??
    fallback
  );
}

function formatMinutesLabel(minutes?: number | null) {
  const safeMinutes = Math.max(0, Number(minutes ?? 0));
  if (!safeMinutes) return "0m";
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function humanizeSource(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return "Attendance record";
  return text.split(/[_\s]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

// ── Zod schema ────────────────────────────────────────────────────────────

const regularizationSchema = z
  .object({
    requestCategory: z.enum(["punch_correction", "status_change", "exception"]),
    attendanceDate: z
      .string()
      .min(1, "Attendance date is required")
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
      .refine((d) => new Date(d + "T00:00:00") <= new Date(), "Cannot regularize a future date"),
    currentStatus: z.string().optional(),
    currentLoginTime: z.string().optional(),
    currentLogoutTime: z.string().optional(),
    requestedLoginTime: z.string().optional(),
    requestedLogoutTime: z.string().optional(),
    requestedStatus: z.enum(["present", "half_day", "absent"]).nullable().optional(),
    disputeType: z.string().nullable().optional(),
    exceptionType: z.string().nullable().optional(),
    reason: z.string().max(500, "Reason must be 500 characters or less").optional(),
  })
  .refine(
    (d) => {
      // status_change requires a target status; exception requires a type
      // punch_correction: times are optional — reason alone is sufficient
      if (d.requestCategory === "status_change") return !!d.requestedStatus;
      if (d.requestCategory === "exception") return !!d.exceptionType;
      return true;
    },
    {
      message: "Required field missing for this request type",
      path: ["requestedStatus"],
    }
  )
  .refine(
    (d) => {
      if (!d.requestedLoginTime || !d.requestedLogoutTime) return true;
      return d.requestedLoginTime < d.requestedLogoutTime;
    },
    { message: "Logout time must be after login time", path: ["requestedLogoutTime"] }
  );

type FormValues = z.infer<typeof regularizationSchema>;

// ── Component ─────────────────────────────────────────────────────────────

const TABLE_PAGE_SIZE = 20;

export default function AttendanceRegularization() {
  const geoCapture = useGeoCapture();
  const { toast } = useToast();
  const { employeeId: currentEmployeeId } = useWorkforceAccess();
  const [requests, setRequests] = useState<EmployeeRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState<EmployeeRequest | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Batch mode state
  const [batchMode, setBatchMode] = useState(false);
  const [batchFromDate, setBatchFromDate] = useState("");
  const [batchToDate, setBatchToDate] = useState("");
  const [batchSelectedDates, setBatchSelectedDates] = useState<Set<string>>(new Set());
  const [batchRangeQueried, setBatchRangeQueried] = useState(false);

  const [searchParams] = useSearchParams();
  const linkedEmployeeId = searchParams.get("employeeId");

  const form = useForm<FormValues>({
    resolver: zodResolver(regularizationSchema),
    defaultValues: {
      requestCategory: "punch_correction",
      attendanceDate: new Date().toISOString().slice(0, 10),
      currentStatus: "",
      currentLoginTime: "",
      currentLogoutTime: "",
      requestedLoginTime: "",
      requestedLogoutTime: "",
      requestedStatus: null,
      disputeType: null,
      exceptionType: null,
      reason: "",
    },
  });

  const requestCategory = form.watch("requestCategory");
  const attendanceDate = form.watch("attendanceDate");
  const debouncedAttendanceDate = useDebounce(attendanceDate, 180);

  const filteredRequests = useMemo(() => {
    return requests.filter((item) => {
      if (filterStatus !== "all" && item.current_status !== filterStatus) return false;
      const detail = item.details?.[0];
      const date = detail?.attendance_date ?? "";
      if (filterFromDate && date && date < filterFromDate) return false;
      if (filterToDate && date && date > filterToDate) return false;
      return true;
    });
  }, [requests, filterStatus, filterFromDate, filterToDate]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / TABLE_PAGE_SIZE));
  const pagedRequests = useMemo(() => {
    const start = (tablePage - 1) * TABLE_PAGE_SIZE;
    return filteredRequests.slice(start, start + TABLE_PAGE_SIZE);
  }, [filteredRequests, tablePage]);

  const stats = useMemo(() => ({
    total: requests.length,
    pendingManager: requests.filter((r) => r.current_status === "pending_manager").length,
    pendingAdmin: requests.filter((r) => r.current_status === "pending_admin").length,
    approved: requests.filter((r) => r.current_status === "approved").length,
    rejected: requests.filter((r) => r.current_status === "rejected").length,
    risky: requests.filter((r) => r.decision_support?.riskLevel === "high").length,
  }), [requests]);

  const safeBulkIds = useMemo(
    () => selectedIds.filter((id) => requests.find((r) => r.id === id)?.decision_support?.canBulkApprove),
    [requests, selectedIds]
  );

  const attendancePreviewQuery = useQuery({
    queryKey: ["regularization-attendance-preview", debouncedAttendanceDate, linkedEmployeeId],
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(debouncedAttendanceDate ?? ""),
    queryFn: async () => {
      const params = new URLSearchParams({ date: debouncedAttendanceDate });
      if (linkedEmployeeId) params.set("employeeId", linkedEmployeeId);
      const res = await hrmsApi.get<{ success: boolean; data: AttendancePreview }>(
        `/api/wfm/regularizations/attendance-preview?${params.toString()}`
      );
      return res.data.data;
    },
    retry: false,
  });

  const dateRangePreviewQuery = useQuery({
    queryKey: ["regularization-date-range-preview", batchFromDate, batchToDate, linkedEmployeeId, batchRangeQueried],
    enabled: batchMode && batchRangeQueried && /^\d{4}-\d{2}-\d{2}$/.test(batchFromDate) && /^\d{4}-\d{2}-\d{2}$/.test(batchToDate) && batchFromDate <= batchToDate,
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: batchFromDate, toDate: batchToDate });
      if (linkedEmployeeId) params.set("employeeId", linkedEmployeeId);
      const res = await hrmsApi.get<{ success: boolean; data: DateRangePreview }>(
        `/api/wfm/regularizations/date-range-preview?${params.toString()}`
      );
      // Auto-select all selectable dates
      const selectableDates = res.data.data.days.filter((d) => d.selectable).map((d) => d.date);
      setBatchSelectedDates(new Set(selectableDates));
      return res.data.data;
    },
    retry: false,
  });

  async function loadRequests() {
    setIsLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: WfmRegularizationRow[] }>("/api/wfm/regularizations");
      setRequests((res.data ?? []).map(normalizeRegularizationRow));
    } catch {
      try {
        const res = await hrmsApi.get<{ success: boolean; data: WfmRegularizationRow[] }>("/api/wfm/regularizations/mine");
        setRequests((res.data ?? []).map(normalizeRegularizationRow));
      } catch {
        setRequests([]);
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
    const dateParam = searchParams.get("date");
    if (dateParam) form.setValue("attendanceDate", dateParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-populate current times from preview; also pre-fill requested times from actual punch data
  useEffect(() => {
    const preview = attendancePreviewQuery.data;
    if (!preview) return;

    form.setValue("currentStatus", preview.currentStatus || "", { shouldDirty: false, shouldValidate: false });
    form.setValue("currentLoginTime", preview.currentLoginTime || "", { shouldDirty: false, shouldValidate: false });
    form.setValue("currentLogoutTime", preview.currentLogoutTime || "", { shouldDirty: false, shouldValidate: false });

    // Auto-fill requested times: use actual punch times if present, else shift defaults
    const dirtyFields = form.formState.dirtyFields;
    const suggestedIn = preview.currentLoginTime || preview.suggestedLoginTime || "";
    const suggestedOut = preview.currentLogoutTime || preview.suggestedLogoutTime || "";

    if (!dirtyFields.requestedLoginTime) {
      form.setValue("requestedLoginTime", suggestedIn, { shouldDirty: false, shouldValidate: false });
    }
    if (!dirtyFields.requestedLogoutTime) {
      form.setValue("requestedLogoutTime", suggestedOut, { shouldDirty: false, shouldValidate: false });
    }
  }, [attendancePreviewQuery.data, form]);

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const geo = await geoCapture();
      const isException = values.requestCategory === "exception";
      const disputeType = isException
        ? (values.exceptionType ?? null)
        : (values.disputeType ?? null);

      return hrmsApi.post("/api/wfm/regularizations", {
        sessionDate: values.attendanceDate,
        oldStatus: values.currentStatus || null,
        oldPunchIn: values.currentLoginTime || null,
        oldPunchOut: values.currentLogoutTime || null,
        newPunchIn: values.requestCategory !== "status_change" ? (values.requestedLoginTime || null) : null,
        newPunchOut: values.requestCategory !== "status_change" ? (values.requestedLogoutTime || null) : null,
        requestedStatus: values.requestedStatus || null,
        disputeType,
        reason:
          values.reason?.trim() ||
          (isException
            ? `Exception: ${disputeType ?? "worked on off-day"} on ${values.attendanceDate}`
            : `Punch correction: ${values.requestedLoginTime ?? ""} – ${values.requestedLogoutTime ?? ""}`),
        supportingNote: values.reason?.trim() || null,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
    },
    onSuccess: () => {
      form.reset({
        requestCategory: form.getValues("requestCategory"),
        attendanceDate: new Date().toISOString().slice(0, 10),
        currentStatus: "",
        currentLoginTime: "",
        currentLogoutTime: "",
        requestedLoginTime: "",
        requestedLogoutTime: "",
        requestedStatus: null,
        disputeType: null,
        exceptionType: null,
        reason: "",
      });
      toast({ title: "Request submitted", description: "Your regularization request has been recorded. Your manager will receive a notification." });
      loadRequests();
    },
    onError: (err: unknown) =>
      toast({ title: "Submission failed", description: getApiErrorMessage(err, "Failed to submit."), variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, force = false }: { id: string; status: "approved" | "rejected"; force?: boolean }) => {
      return hrmsApi.patch(`/api/wfm/regularizations/${id}/review`, { status, force });
    },
    onSuccess: () => {
      toast({ title: "Review saved", description: "The approval queue has been updated." });
      setSelectedIds([]);
      loadRequests();
    },
    onError: (err: unknown) =>
      toast({ title: "Review failed", description: getApiErrorMessage(err, "Failed to review request."), variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => hrmsApi.patch("/api/wfm/regularizations/bulk-review", { ids, status: "approved" }),
    onSuccess: (response: BulkReviewResponse) => {
      const data = response?.data;
      const succeeded = data?.succeeded ?? 0;
      const failed = data?.failed ?? 0;
      if (failed > 0) {
        const failedItems = (data?.data ?? []).filter((row) => !row.success);
        const failedDetail = failedItems.slice(0, 3).map((row) => row.message ?? row.id ?? "Unknown").join("; ");
        toast({ title: `${succeeded} approved, ${failed} failed`, description: failedDetail || "Some requests could not be processed.", variant: "destructive" });
      } else {
        toast({ title: "Bulk approval completed", description: `${succeeded} request(s) approved successfully.` });
      }
      setSelectedIds([]);
      loadRequests();
    },
    onError: (err: unknown) =>
      toast({ title: "Bulk approval failed", description: getApiErrorMessage(err, "Failed to bulk approve."), variant: "destructive" }),
  });

  const batchSubmitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const geo = await geoCapture();
      const dates = Array.from(batchSelectedDates).sort();
      const isException = values.requestCategory === "exception";
      const disputeType = isException ? (values.exceptionType ?? null) : (values.disputeType ?? null);
      return hrmsApi.post<BatchSubmitResult>("/api/wfm/regularizations/batch", {
        sessionDates: dates,
        requestedStatus: values.requestedStatus || null,
        disputeType,
        newPunchIn: values.requestCategory !== "status_change" ? (values.requestedLoginTime || null) : null,
        newPunchOut: values.requestCategory !== "status_change" ? (values.requestedLogoutTime || null) : null,
        reason: values.reason?.trim() || `Batch ${values.requestCategory === "exception" ? "exception" : "correction"}: ${dates.length} date(s)`,
        supportingNote: values.reason?.trim() || null,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
    },
    onSuccess: (response) => {
      const d = (response as any)?.data;
      const succeeded = d?.succeeded ?? 0;
      const failed = d?.failed ?? 0;
      if (failed > 0) {
        const failedItems = ((d?.data ?? []) as any[]).filter((r: any) => !r.success);
        const msg = failedItems.slice(0, 3).map((r: any) => `${r.date}: ${r.message ?? "failed"}`).join("; ");
        toast({ title: `${succeeded} submitted, ${failed} skipped`, description: msg, variant: "destructive" });
      } else {
        toast({ title: `${succeeded} request(s) submitted`, description: "Manager will receive a notification for all selected dates." });
      }
      setBatchSelectedDates(new Set());
      setBatchRangeQueried(false);
      setBatchFromDate("");
      setBatchToDate("");
      loadRequests();
    },
    onError: (err: unknown) =>
      toast({ title: "Batch submission failed", description: getApiErrorMessage(err, "Failed to submit."), variant: "destructive" }),
  });

  function getDetail(request: EmployeeRequest) {
    return request.regularization_request_detail?.[0] || null;
  }

  const preview = attendancePreviewQuery.data;
  const categoryConfig = REQUEST_CATEGORIES.find((c) => c.value === requestCategory)!;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="rounded-xl border border-emerald-200 bg-[linear-gradient(135deg,#ecfdf5_0%,#d1fae5_45%,#f0fdf4_100%)] p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-600 p-2 text-white shadow-sm">
                <CalendarCheck className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-950">Attendance Regularization</h1>
                <p className="mt-0.5 text-xs text-slate-600">
                  Select request type → pick date → review auto-loaded record → submit. Approval flows to your manager first, then WFM.
                </p>
              </div>
            </div>
            <button
              onClick={loadRequests}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {linkedEmployeeId && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Deep-linked from notification — Employee ID: <span className="font-mono font-bold">{linkedEmployeeId}</span>
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total Requests" value={stats.total} />
          <StatCard label="Pending Manager" value={stats.pendingManager} accent="amber" />
          <StatCard label="Pending WFM" value={stats.pendingAdmin} accent="sky" />
          <StatCard label="Approved" value={stats.approved} accent="emerald" />
          <StatCard label="High Risk" value={stats.risky} accent="rose" />
        </div>

        {/* Step 1: Request Type Selection */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Step 1</p>
            <h2 className="text-sm font-semibold text-slate-950">What do you need to fix?</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {REQUEST_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => {
                  form.setValue("requestCategory", cat.value, { shouldDirty: false });
                  form.setValue("disputeType", null);
                  form.setValue("exceptionType", null);
                  form.setValue("requestedStatus", null);
                }}
                className={cn(
                  "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all",
                  requestCategory === cat.value
                    ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                )}
              >
                <div className={cn("flex items-center gap-2 font-semibold text-sm", requestCategory === cat.value ? "text-emerald-700" : "text-slate-800")}>
                  {cat.icon}
                  {cat.label}
                </div>
                <p className="text-xs text-slate-500">{cat.description}</p>
              </button>
            ))}
          </div>
          {categoryConfig && (
            <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              {categoryConfig.hint}
            </div>
          )}
        </div>

        {/* Step 2: Form */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Step 2</p>
                <h2 className="text-sm font-semibold text-slate-950">
                  {requestCategory === "exception" ? "Exception Details" : "Correction Details"}
                </h2>
              </div>
              {requestCategory !== "exception" && (
                <button
                  type="button"
                  onClick={() => { setBatchMode((v) => !v); setBatchRangeQueried(false); setBatchSelectedDates(new Set()); }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                    batchMode
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  )}
                >
                  <Layers className="h-3.5 w-3.5" />
                  {batchMode ? "Batch ON — click to disable" : "Multi-date / Batch"}
                </button>
              )}
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => submitMutation.mutate(v))} className="space-y-4">

                {/* Date + Dispute/Exception Type */}
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="attendanceDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          Attendance Date <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input type="date" {...field} className="h-9 text-sm" />
                        </FormControl>
                        <FormDescription className="text-xs">Cannot be a future date.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {requestCategory === "exception" ? (
                    <FormField
                      control={form.control}
                      name="exceptionType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Exception Type <span className="text-rose-500">*</span></FormLabel>
                          <Select
                            value={field.value ?? "none"}
                            onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                          >
                            <FormControl>
                              <SelectTrigger className="h-9 bg-white !text-slate-900 text-sm [&>span]:!text-slate-900">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white !text-slate-900">
                              <SelectItem value="none">Select type</SelectItem>
                              {EXCEPTION_TYPES.map((et) => (
                                <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <FormField
                      control={form.control}
                      name="disputeType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Issue Type <span className="text-slate-400 font-normal">(optional)</span></FormLabel>
                          <Select
                            value={field.value ?? "none"}
                            onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                          >
                            <FormControl>
                              <SelectTrigger className="h-9 bg-white !text-slate-900 text-sm [&>span]:!text-slate-900">
                                <SelectValue placeholder="Select issue type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white !text-slate-900">
                              <SelectItem value="none">None</SelectItem>
                              {disputeTypesForCategory(requestCategory).map((dt) => (
                                <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                {/* System Record — auto-populated */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">System Record (Auto-loaded)</p>
                    <div className="flex items-center gap-2">
                      {attendancePreviewQuery.isFetching && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading…
                        </span>
                      )}
                      {preview && !attendancePreviewQuery.isFetching && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Loaded
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="currentStatus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Current Status</FormLabel>
                          <FormControl>
                            <Input {...field} readOnly className="h-9 border-slate-200 bg-white text-sm font-medium" placeholder="—" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="currentLoginTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Recorded Login</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} readOnly placeholder="—" className="h-9 border-slate-200 bg-white text-sm" />
                          </FormControl>
                          {!field.value && preview && (
                            <FormDescription className="text-xs text-amber-600">No login recorded</FormDescription>
                          )}
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="currentLogoutTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Recorded Logout</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} readOnly placeholder="—" className="h-9 border-slate-200 bg-white text-sm" />
                          </FormControl>
                          {!field.value && preview && (
                            <FormDescription className="text-xs text-amber-600">No logout recorded</FormDescription>
                          )}
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-dashed border-slate-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
                      Your Correction
                    </span>
                  </div>
                </div>

                {/* Correction fields — vary by request type */}
                {requestCategory === "status_change" && (
                  <FormField
                    control={form.control}
                    name="requestedStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Requested Status <span className="text-rose-500">*</span></FormLabel>
                        <Select
                          value={field.value ?? "none"}
                          onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                        >
                          <FormControl>
                            <SelectTrigger className="h-9 bg-white !text-slate-900 text-sm [&>span]:!text-slate-900">
                              <SelectValue placeholder="Select correct status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="bg-white !text-slate-900">
                            <SelectItem value="none">Select status</SelectItem>
                            <SelectItem value="present">Present</SelectItem>
                            <SelectItem value="half_day">Half Day</SelectItem>
                            <SelectItem value="absent">Absent</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-xs">What should your attendance status be?</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {requestCategory === "exception" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-semibold">Exception Request Flow</p>
                    <p className="mt-1">
                      Your request will go to your manager for approval, then to WFM to process compensation
                      (overtime pay or comp-off). Enter the actual hours worked below so WFM can calculate correctly.
                    </p>
                  </div>
                )}

                {(requestCategory === "punch_correction" || requestCategory === "exception") && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="requestedLoginTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">
                            {requestCategory === "exception" ? "Actual Start Time" : "Correct Login Time"}
                            <span className="ml-1 font-normal text-slate-400">(optional)</span>
                          </FormLabel>
                          <FormControl>
                            <Input type="time" {...field} className="h-9 text-sm" />
                          </FormControl>
                          <FormDescription className="text-xs">
                            {requestCategory === "exception" ? "When did you actually start work?" : "Leave blank if only the status needs fixing."}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="requestedLogoutTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">
                            {requestCategory === "exception" ? "Actual End Time" : "Correct Logout Time"}
                            <span className="ml-1 font-normal text-slate-400">(optional)</span>
                          </FormLabel>
                          <FormControl>
                            <Input type="time" {...field} className="h-9 text-sm" />
                          </FormControl>
                          <FormDescription className="text-xs">Must be after login time if both are filled.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Reason */}
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => {
                    const len = field.value?.length ?? 0;
                    return (
                      <FormItem>
                        <FormLabel className="text-xs">
                          Reason <span className="text-slate-400 font-normal">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={
                              requestCategory === "exception"
                                ? "Describe the work done, approving manager instruction, etc."
                                : "Describe why the correction is needed."
                            }
                            className="min-h-[64px] text-sm"
                            {...field}
                          />
                        </FormControl>
                        <div className="flex items-center justify-between gap-3">
                          <FormDescription className="text-xs">
                            Providing a reason speeds up manager approval.
                          </FormDescription>
                          <span className={cn("text-xs tabular-nums", len > 450 ? "font-semibold text-rose-500" : "text-slate-400")}>
                            {len}/500
                          </span>
                        </div>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                {/* Batch mode — date range picker and grid */}
                {batchMode && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
                    <p className="text-xs font-semibold text-indigo-800">
                      Multi-date Batch Mode — select a range and pick dates to submit together
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700">From Date</label>
                        <Input
                          type="date"
                          value={batchFromDate}
                          onChange={(e) => { setBatchFromDate(e.target.value); setBatchRangeQueried(false); }}
                          className="mt-1 h-9 text-sm"
                          max={new Date().toISOString().slice(0, 10)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700">To Date</label>
                        <Input
                          type="date"
                          value={batchToDate}
                          onChange={(e) => { setBatchToDate(e.target.value); setBatchRangeQueried(false); }}
                          className="mt-1 h-9 text-sm"
                          max={new Date().toISOString().slice(0, 10)}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-full text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                          disabled={!batchFromDate || !batchToDate || batchFromDate > batchToDate || dateRangePreviewQuery.isFetching}
                          onClick={() => setBatchRangeQueried(true)}
                        >
                          {dateRangePreviewQuery.isFetching ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Scanning…</> : "Scan Dates"}
                        </Button>
                      </div>
                    </div>

                    {dateRangePreviewQuery.isError && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        {getApiErrorMessage(dateRangePreviewQuery.error, "Could not load date range.")}
                      </div>
                    )}

                    {dateRangePreviewQuery.data && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-slate-900">
                            {dateRangePreviewQuery.data.days.filter((d) => d.selectable).length} selectable ·{" "}
                            {batchSelectedDates.size} selected
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-xs text-indigo-600 hover:underline"
                              onClick={() => setBatchSelectedDates(new Set(dateRangePreviewQuery.data!.days.filter((d) => d.selectable).map((d) => d.date)))}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="text-xs text-slate-500 hover:underline"
                              onClick={() => setBatchSelectedDates(new Set())}
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <table className="min-w-full divide-y divide-slate-100 text-xs">
                            <thead className="bg-slate-50">
                              <tr>
                                <th className="px-2 py-2 text-left font-semibold text-slate-500">✓</th>
                                <th className="px-3 py-2 text-left font-semibold text-slate-500">Date</th>
                                <th className="px-3 py-2 text-left font-semibold text-slate-500">Day</th>
                                <th className="px-3 py-2 text-left font-semibold text-slate-500">Current Status</th>
                                <th className="px-3 py-2 text-left font-semibold text-slate-500">Login</th>
                                <th className="px-3 py-2 text-left font-semibold text-slate-500">Logout</th>
                                <th className="px-3 py-2 text-left font-semibold text-slate-500">Note</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {dateRangePreviewQuery.data.days.map((day) => {
                                const checked = batchSelectedDates.has(day.date);
                                const dayName = new Date(day.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
                                return (
                                  <tr key={day.date} className={cn("hover:bg-slate-50", !day.selectable && "opacity-50")}>
                                    <td className="px-2 py-1.5">
                                      <input
                                        type="checkbox"
                                        className="h-3.5 w-3.5 rounded border-slate-300"
                                        checked={checked}
                                        disabled={!day.selectable}
                                        onChange={(e) => {
                                          setBatchSelectedDates((prev) => {
                                            const next = new Set(prev);
                                            if (e.target.checked) next.add(day.date);
                                            else next.delete(day.date);
                                            return next;
                                          });
                                        }}
                                      />
                                    </td>
                                    <td className="px-3 py-1.5 font-medium text-slate-900">{day.date}</td>
                                    <td className="px-3 py-1.5 text-slate-500">{dayName}</td>
                                    <td className="px-3 py-1.5">
                                      <span className={cn(
                                        "rounded px-1.5 py-0.5 font-semibold text-[11px]",
                                        day.currentStatus === "Present" ? "bg-emerald-100 text-emerald-700" :
                                        day.currentStatus === "Absent" ? "bg-rose-100 text-rose-700" :
                                        day.currentStatus === "Half Day" ? "bg-amber-100 text-amber-700" :
                                        "bg-slate-100 text-slate-600"
                                      )}>
                                        {day.currentStatus}
                                      </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-slate-600">{day.loginTime || "—"}</td>
                                    <td className="px-3 py-1.5 text-slate-600">{day.logoutTime || "—"}</td>
                                    <td className="px-3 py-1.5 text-slate-400">
                                      {day.alreadyRequested ? (
                                        <span className="text-amber-600 font-medium">Request pending</span>
                                      ) : !day.hasRecord ? (
                                        <span className="text-slate-400">No record</span>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">Approval flow: </span>
                  Your request → Reporting Manager (Stage 1) → Branch WFM (Stage 2 / final)
                </div>

                <div className="flex justify-end">
                  {batchMode && batchSelectedDates.size > 0 ? (
                    <Button
                      type="button"
                      disabled={batchSubmitMutation.isPending}
                      onClick={() => form.handleSubmit((v) => batchSubmitMutation.mutate(v))()}
                      className="h-9 w-full sm:w-auto text-sm bg-indigo-600 hover:bg-indigo-700"
                    >
                      {batchSubmitMutation.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting {batchSelectedDates.size} dates…</>
                      ) : (
                        <><Send className="mr-2 h-4 w-4" />Submit {batchSelectedDates.size} date(s)</>
                      )}
                    </Button>
                  ) : (
                    <Button type="submit" disabled={submitMutation.isPending || (batchMode && batchSelectedDates.size === 0)} className="h-9 w-full sm:w-auto text-sm">
                      {submitMutation.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
                      ) : batchMode ? (
                        <span className="text-slate-400">Select dates above to submit</span>
                      ) : (
                        <><Send className="mr-2 h-4 w-4" />Submit Request</>
                      )}
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </div>

          {/* Right panel: attendance snapshot */}
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">Date Snapshot</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Auto-pulled for selected date</p>
                </div>
                {preview && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                    {humanizeSource(preview.attendanceSource)}
                  </span>
                )}
              </div>

              <div className="mt-3">
                {attendancePreviewQuery.isLoading || attendancePreviewQuery.isFetching ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Pulling record…
                  </div>
                ) : attendancePreviewQuery.isError ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                    Could not load system record for this date. You can still submit, but the reviewer will have less context.
                  </div>
                ) : preview ? (
                  <div className="space-y-3">
                    <div className="grid gap-2">
                      <PreviewMetric label="Status" value={preview.currentStatus} />
                      <PreviewMetric label="Login Time" value={preview.currentLoginTime || "Not recorded"} />
                      <PreviewMetric label="Logout Time" value={preview.currentLogoutTime || "Not recorded"} />
                      <PreviewMetric label="Punch Count" value={String(preview.totalPunches)} />
                      <PreviewMetric label="Duration" value={formatMinutesLabel(preview.biometricMinutes || preview.rawMinutes)} />
                    </div>
                    {(!preview.currentLoginTime && !preview.currentLogoutTime) && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <p className="font-semibold">No punch record for this date</p>
                        <p className="mt-1">No biometric data found. Request will need manual evidence review.</p>
                      </div>
                    )}
                    {preview.punches.length > 0 && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                        <p className="font-semibold text-slate-900 mb-1.5">Detected Punches</p>
                        <div className="space-y-1">
                          {preview.punches.map((punch, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className={cn(
                                "rounded px-1.5 py-0.5 font-semibold",
                                punch.ioLabel === "In" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                              )}>
                                {punch.ioLabel}
                              </span>
                              <span className="text-slate-600">{formatDateTime(punch.punchTime)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      <p className="font-semibold text-slate-900 mb-1">Shift Window</p>
                      <p>{preview.suggestedLoginTime || "--:--"} → {preview.suggestedLogoutTime || "--:--"}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                    Choose a date to load the attendance snapshot.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Requests List */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">My Requests</h2>
                <p className="mt-0.5 text-xs text-slate-500">Track status, view approval stages and evidence. ({filteredRequests.length} of {requests.length})</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safeBulkIds.length === 0 || bulkApproveMutation.isPending}
                onClick={() => bulkApproveMutation.mutate(safeBulkIds)}
                className="h-9 text-xs"
              >
                {bulkApproveMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                Bulk approve safe ({safeBulkIds.length})
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setTablePage(1); }}>
                <SelectTrigger className="h-9 w-40 bg-white !text-slate-900 text-sm [&>span]:!text-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white !text-slate-900">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending_manager">Pending Manager</SelectItem>
                  <SelectItem value="pending_admin">Pending WFM</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <input
                type="date"
                className="h-9 rounded-lg border border-gray-200 px-2.5 text-sm bg-white text-slate-900"
                value={filterFromDate}
                onChange={(e) => { setFilterFromDate(e.target.value); setTablePage(1); }}
                title="From date"
              />
              <span className="flex items-center text-xs text-slate-400">to</span>
              <input
                type="date"
                className="h-9 rounded-lg border border-gray-200 px-2.5 text-sm bg-white text-slate-900"
                value={filterToDate}
                onChange={(e) => { setFilterToDate(e.target.value); setTablePage(1); }}
                title="To date"
              />
              {(filterFromDate || filterToDate) && (
                <button
                  onClick={() => { setFilterFromDate(""); setFilterToDate(""); setTablePage(1); }}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500 hover:bg-slate-50"
                >
                  Clear dates
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            {isLoading ? (
              <div className="flex items-center gap-2 p-4 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading requests…
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">No regularization requests found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Select</Th>
                      <Th>Request</Th>
                      <Th>Date</Th>
                      <Th>Type</Th>
                      <Th>Status</Th>
                      <Th>Stage</Th>
                      <Th>Risk</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {pagedRequests.map((request) => {
                      const detail = getDetail(request);
                      const isSelected = selectedIds.includes(request.id);
                      const isException = request.request_type_code === "exception";
                      const isOwnRequest = currentEmployeeId && request.employee_id === currentEmployeeId;
                      return (
                        <tr key={request.id} className="hover:bg-slate-50">
                          <Td>
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-slate-300"
                              checked={isSelected}
                              onChange={(event) => {
                                setSelectedIds((current) =>
                                  event.target.checked
                                    ? Array.from(new Set([...current, request.id]))
                                    : current.filter((id) => id !== request.id)
                                );
                              }}
                            />
                          </Td>
                          <Td>
                            <div className="font-semibold text-slate-950">{request.request_no}</div>
                            {request.submitted_by && <div className="text-slate-500">{request.submitted_by}</div>}
                            <div className="mt-0.5 text-slate-400">{formatDateTime(request.created_at)}</div>
                          </Td>
                          <Td>{detail?.attendance_date || "—"}</Td>
                          <Td>
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                              isException
                                ? "border-purple-200 bg-purple-50 text-purple-700"
                                : "border-slate-200 bg-slate-50 text-slate-600"
                            )}>
                              {isException ? <Zap className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                              {isException ? "Exception" : "Regularization"}
                            </span>
                          </Td>
                          <Td><StatusBadge status={request.current_status} /></Td>
                          <Td>
                            <div className="text-slate-900">{request.current_stage_name || "—"}</div>
                            <div className="text-slate-400">{request.current_owner_role || "—"}</div>
                          </Td>
                          <Td><RiskBadge support={request.decision_support} /></Td>
                          <Td>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                onClick={() => setSelectedRequest(request)}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                View
                              </button>
                              {["pending_manager", "pending_admin"].includes(request.current_status) && !isOwnRequest && (
                                <>
                                  <button
                                    onClick={() => reviewMutation.mutate({ id: request.id, status: "approved" })}
                                    className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => reviewMutation.mutate({ id: request.id, status: "rejected" })}
                                    className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
                <span className="text-xs text-slate-500">
                  Page {tablePage} of {totalPages} ({filteredRequests.length} records)
                </span>
                <div className="flex gap-1.5">
                  <button
                    disabled={tablePage <= 1}
                    onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    disabled={tablePage >= totalPages}
                    onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                    className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedRequest && (
        <DetailDialog request={selectedRequest} onClose={() => setSelectedRequest(null)} />
      )}
    </DashboardLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent?: "amber" | "sky" | "emerald" | "rose" }) {
  const accentClass: Record<string, string> = {
    amber: "text-amber-600",
    sky: "text-sky-600",
    emerald: "text-emerald-600",
    rose: "text-rose-600",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold", accent ? accentClass[accent] : "text-slate-950")}>{value}</p>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return <td className="whitespace-nowrap px-3 py-2 text-slate-600">{children}</td>;
}

function StatusBadge({ status }: { status: string }) {
  // Distinct visual styles per stage — not just one generic "pending" yellow
  const stageTone: Record<string, string> = {
    submitted:       "border-slate-200 bg-slate-50 text-slate-600",
    pending_manager: "border-amber-200 bg-amber-50 text-amber-700",
    pending_admin:   "border-blue-200 bg-blue-50 text-blue-700",
    approved:        "border-emerald-200 bg-emerald-50 text-emerald-700",
    rejected:        "border-rose-200 bg-rose-50 text-rose-700",
    cancelled:       "border-slate-200 bg-slate-100 text-slate-500",
  };
  const tone = stageTone[status] ?? "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}>
      {statusLabel[status] || status}
    </span>
  );
}

function RiskBadge({ support }: { support?: RegularizationDecisionSupport }) {
  if (!support) return <span className="text-xs text-slate-400">—</span>;
  const tone = support.riskLevel === "high"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : support.riskLevel === "medium"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold uppercase", tone)}>
      {support.riskLevel !== "low" ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {support.riskLevel} · {support.riskScore}
    </span>
  );
}

function DetailDialog({ request, onClose }: { request: EmployeeRequest; onClose: () => void }) {
  const detail = request.regularization_request_detail?.[0] || null;
  const stages = [...(request.request_approval_stage || [])].sort((a, b) => a.stage_no - b.stage_no);
  const support = request.decision_support;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Request Detail</p>
            <h3 className="mt-0.5 text-lg font-semibold text-slate-950">{request.request_no}</h3>
            <div className="mt-1.5 flex items-center gap-2">
              <StatusBadge status={request.current_status} />
              {request.request_type_code === "exception" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">
                  <Zap className="h-3 w-3" />
                  Exception
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Close
          </button>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <h4 className="text-xs font-semibold text-slate-950">Correction Details</h4>
            <div className="mt-3 grid gap-2 text-xs">
              <InfoRow label="Date" value={detail?.attendance_date} />
              <InfoRow label="Current Status" value={detail?.current_status} />
              <InfoRow label="Current Login" value={detail?.current_login_time} />
              <InfoRow label="Current Logout" value={detail?.current_logout_time} />
              <InfoRow label="Requested Login" value={detail?.requested_login_time} />
              <InfoRow label="Requested Logout" value={detail?.requested_logout_time} />
              <InfoRow label="Reason" value={request.reason} />
              <InfoRow label="Payroll Status" value={request.payroll_impact_status} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <h4 className="text-xs font-semibold text-slate-950">Approval Stages</h4>
            <div className="mt-3 space-y-2">
              {stages.map((stage) => (
                <div key={stage.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-950">Stage {stage.stage_no}: {stage.stage_name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">Role: {stage.approver_role || "—"}</p>
                    </div>
                    <StatusBadge status={stage.status} />
                  </div>
                  {stage.remarks && <p className="mt-1.5 text-xs text-slate-500">Remarks: {stage.remarks}</p>}
                  {stage.acted_at && <p className="mt-1 text-xs text-slate-400">Acted at: {formatDateTime(stage.acted_at)}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {support && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-950">WFM Validation Evidence</h4>
              <RiskBadge support={support} />
            </div>
            {support.flags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {support.flags.map((flag) => (
                  <span key={flag} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    <AlertTriangle className="h-3 w-3" />
                    {flag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                No major risk detected
              </div>
            )}
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
              <InfoRow label="Current Attendance" value={support.evidence.currentAttendanceStatus} />
              <InfoRow label="Current LWP" value={String(support.evidence.currentLwp ?? "—")} />
              <InfoRow label="First Punch" value={support.evidence.firstPunch} />
              <InfoRow label="Last Punch" value={support.evidence.lastPunch} />
              <InfoRow label="Total Punches" value={String(support.evidence.totalPunches)} />
              <InfoRow label="Biometric Minutes" value={String(support.evidence.biometricMinutes ?? "—")} />
              <InfoRow label="Roster Status" value={support.evidence.rosterStatus} />
              <InfoRow label="Shift" value={`${support.evidence.rosterShiftStart ?? "?"} – ${support.evidence.rosterShiftEnd ?? "?"}`} />
              <InfoRow label="Duplicate Requests" value={String(support.evidence.duplicateRequests)} />
              <InfoRow label="Recent Requests (30d)" value={String(support.evidence.recentRequests)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-1.5 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value || "—"}</span>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}
