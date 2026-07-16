import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useGeoCapture } from "@/hooks/useGeoCapture";
import { useDebounce } from "@/hooks/useDebounce";
import { useSearchParams } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatusBadge as SmartHRStatusBadge, normalizeStatus } from "@/components/ui/status-badge";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CalendarCheck, CheckCircle2, Loader2, RefreshCw, Send } from "lucide-react";
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
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
  message?: string;
};

type BulkReviewResponse = {
  data?: {
    succeeded?: number;
    failed?: number;
    data?: Array<{
      success?: boolean;
      message?: string;
      id?: string;
    }>;
  };
};

// ── Constants ─────────────────────────────────────────────────────────────

const statusLabel: Record<string, string> = {
  submitted: "Submitted",
  pending_manager: "Pending Manager",
  pending_admin: "Pending Admin / WFM",
  manager_approved: "Pending WFM",
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
  return {
    id: row.id,
    request_id: row.id,
    request_no: `${row.employee_code ?? "REG"}-${attendanceDate || row.id.slice(0, 8)}`,
    employee_id: row.employee_id,
    submitted_by: row.employee_name ?? row.employee_code ?? null,
    request_type_code: "attendance_regularization",
    title: `Attendance regularization for ${attendanceDate || "selected date"}`,
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

function shouldReplaceSuggestedTime(currentValue: string | undefined, defaultValue: string) {
  return !currentValue || currentValue === defaultValue;
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
  return text
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

const DISPUTE_TYPES = [
  { value: "missing_punch", label: "Missing Punch" },
  { value: "wrong_punch", label: "Wrong Punch" },
  { value: "late_mark_dispute", label: "Late Mark Dispute" },
  { value: "early_logout_dispute", label: "Early Logout Dispute" },
  { value: "half_day_dispute", label: "Half Day Dispute" },
  { value: "absent_wrongly_marked", label: "Absent Wrongly Marked" },
  { value: "week_off_worked", label: "Week-Off Worked" },
  { value: "holiday_worked", label: "Holiday Worked" },
  { value: "shift_mismatch", label: "Shift Mismatch" },
  { value: "cosec_sync_issue", label: "CosEC Sync Issue" },
  { value: "manual_punch_correction", label: "Manual Punch Correction" },
];

// ── Zod schema ────────────────────────────────────────────────────────────

const regularizationSchema = z
  .object({
    attendanceDate: z
      .string()
      .min(1, "Attendance date is required")
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
      .refine(
        (d) => new Date(d + "T00:00:00") <= new Date(),
        "Cannot regularize a future date"
      ),
    currentStatus: z.string().optional(),
    currentLoginTime: z.string().optional(),
    currentLogoutTime: z.string().optional(),
    requestedLoginTime: z.string().optional(),
    requestedLogoutTime: z.string().optional(),
    requestedStatus: z.enum(["present", "half_day", "absent"]).nullable().optional(),
    disputeType: z.string().nullable().optional(),
    reason: z.string().max(500, "Reason must be 500 characters or less").optional(),
  })
  .refine((d) => d.requestedLoginTime || d.requestedLogoutTime, {
    message: "At least one requested time (login or logout) is required",
    path: ["requestedLoginTime"],
  })
  .refine(
    (d) => {
      if (!d.requestedLoginTime || !d.requestedLogoutTime) return true;
      return d.requestedLoginTime < d.requestedLogoutTime;
    },
    { message: "Logout time must be after login time", path: ["requestedLogoutTime"] }
  );

type FormValues = z.infer<typeof regularizationSchema>;

// ── Component ─────────────────────────────────────────────────────────────

export default function AttendanceRegularization() {
  const geoCapture = useGeoCapture();
  const { toast } = useToast();
  const [requests, setRequests] = useState<EmployeeRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedRequest, setSelectedRequest] = useState<EmployeeRequest | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [searchParams] = useSearchParams();
  const linkedEmployeeId = searchParams.get("employeeId");

  const form = useForm<FormValues>({
    resolver: zodResolver(regularizationSchema),
    defaultValues: {
      attendanceDate: new Date().toISOString().slice(0, 10),
      currentStatus: "Absent",
      currentLoginTime: "",
      currentLogoutTime: "",
      requestedLoginTime: "09:30",
      requestedLogoutTime: "18:30",
      requestedStatus: null,
      disputeType: null,
      reason: "",
    },
  });
  const attendanceDate = form.watch("attendanceDate");
  const debouncedAttendanceDate = useDebounce(attendanceDate, 180);

  const filteredRequests = useMemo(() => {
    if (filterStatus === "all") return requests;
    return requests.filter((item) => item.current_status === filterStatus);
  }, [requests, filterStatus]);

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

  useEffect(() => {
    const preview = attendancePreviewQuery.data;
    if (!preview) return;

    form.setValue("currentStatus", preview.currentStatus || "Absent", { shouldDirty: false, shouldValidate: false });
    form.setValue("currentLoginTime", preview.currentLoginTime || "", { shouldDirty: false, shouldValidate: false });
    form.setValue("currentLogoutTime", preview.currentLogoutTime || "", { shouldDirty: false, shouldValidate: false });

    const dirtyFields = form.formState.dirtyFields;
    if (!dirtyFields.requestedLoginTime && preview.suggestedLoginTime && shouldReplaceSuggestedTime(form.getValues("requestedLoginTime"), "09:30")) {
      form.setValue("requestedLoginTime", preview.suggestedLoginTime, { shouldDirty: false, shouldValidate: false });
    }
    if (!dirtyFields.requestedLogoutTime && preview.suggestedLogoutTime && shouldReplaceSuggestedTime(form.getValues("requestedLogoutTime"), "18:30")) {
      form.setValue("requestedLogoutTime", preview.suggestedLogoutTime, { shouldDirty: false, shouldValidate: false });
    }
  }, [attendancePreviewQuery.data, form]);

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const geo = await geoCapture();
      return hrmsApi.post("/api/wfm/regularizations", {
        sessionDate: values.attendanceDate,
        oldStatus: values.currentStatus || null,
        oldPunchIn: values.currentLoginTime || null,
        oldPunchOut: values.currentLogoutTime || null,
        newPunchIn: values.requestedLoginTime || null,
        newPunchOut: values.requestedLogoutTime || null,
        requestedStatus: values.requestedStatus || null,
        disputeType: values.disputeType || null,
        reason:
          values.reason?.trim() ||
          `Login: ${values.requestedLoginTime ?? ""} Logout: ${values.requestedLogoutTime ?? ""}`.trim(),
        supportingNote: values.reason?.trim() || null,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
    },
    onSuccess: () => {
      const preview = attendancePreviewQuery.data;
      form.reset({
        attendanceDate: new Date().toISOString().slice(0, 10),
        currentStatus: preview?.currentStatus || "Absent",
        currentLoginTime: preview?.currentLoginTime || "",
        currentLogoutTime: preview?.currentLogoutTime || "",
        requestedLoginTime: preview?.suggestedLoginTime || "09:30",
        requestedLogoutTime: preview?.suggestedLogoutTime || "18:30",
        requestedStatus: null,
        disputeType: null,
        reason: "",
      });
      toast({ title: "Request submitted", description: "Your regularization request has been recorded." });
      loadRequests();
    },
    onError: (err: unknown) =>
      toast({
        title: "Submission failed",
        description: getApiErrorMessage(err, "Failed to submit."),
        variant: "destructive",
      }),
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
      toast({
        title: "Review failed",
        description: getApiErrorMessage(err, "Failed to review request."),
        variant: "destructive",
      }),
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
        toast({
          title: `${succeeded} approved, ${failed} failed`,
          description: failedDetail || "Some requests could not be processed. Check individual items.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Bulk approval completed", description: `${succeeded} request(s) approved successfully.` });
      }
      setSelectedIds([]);
      loadRequests();
    },
    onError: (err: unknown) =>
      toast({
        title: "Bulk approval failed",
        description: getApiErrorMessage(err, "Failed to bulk approve."),
        variant: "destructive",
      }),
  });

  function getDetail(request: EmployeeRequest) {
    return request.regularization_request_detail?.[0] || null;
  }

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
                  Pull the exact record for the selected date, submit the correction, and track approval in one place.
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
            Deep-linked from notification — Employee ID:{" "}
            <span className="font-mono font-bold">{linkedEmployeeId}</span>. The date below has been
            pre-filled.
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total Requests" value={stats.total} />
          <StatCard label="Pending Manager" value={stats.pendingManager} accent="amber" />
          <StatCard label="Pending Admin" value={stats.pendingAdmin} accent="sky" />
          <StatCard label="Approved" value={stats.approved} accent="emerald" />
          <StatCard label="High Risk" value={stats.risky} accent="rose" />
        </div>

        {/* Submission Form */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">New Regularization Request</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Select the date first. The system record loads automatically, and you only enter the correction.
            </p>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((v) => submitMutation.mutate(v))}
                className="mt-3 space-y-4"
              >
              {/* Row 1: Date + Dispute Type */}
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

                <FormField
                  control={form.control}
                  name="disputeType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Dispute Type{" "}
                        <span className="text-slate-400 font-normal text-xs">(optional)</span>
                      </FormLabel>
                      <Select
                        value={field.value ?? "none"}
                        onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                      >
                        <FormControl>
                          <SelectTrigger className="h-9 bg-white !text-slate-900 text-sm [&>span]:!text-slate-900">
                            <SelectValue placeholder="Select dispute type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-white !text-slate-900">
                          <SelectItem value="none">None</SelectItem>
                          {DISPUTE_TYPES.map((dt) => (
                            <SelectItem key={dt.value} value={dt.value}>
                              {dt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                        System Record
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        This section is auto-filled from the attendance record for the selected date.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {attendancePreviewQuery.isFetching && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Syncing record
                        </span>
                      )}
                      {attendancePreviewQuery.data && !attendancePreviewQuery.isFetching && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Record loaded
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
                            <Input {...field} readOnly className="h-9 border-slate-200 bg-white text-sm font-medium" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="currentLoginTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Current Login Time</FormLabel>
                          <FormControl>
                            <Input
                              type="time"
                              {...field}
                              readOnly
                              placeholder="No record"
                              className="h-9 border-slate-200 bg-white text-sm"
                            />
                          </FormControl>
                          {!field.value && (
                            <FormDescription className="text-xs text-amber-600">
                              No login time recorded for this date
                            </FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="currentLogoutTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Current Logout Time</FormLabel>
                          <FormControl>
                            <Input
                              type="time"
                              {...field}
                              readOnly
                              placeholder="No record"
                              className="h-9 border-slate-200 bg-white text-sm"
                            />
                          </FormControl>
                          {!field.value && (
                            <FormDescription className="text-xs text-amber-600">
                              No logout time recorded for this date
                            </FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-xs font-medium text-slate-700">Shift In Time</label>
                      <Input
                        type="time"
                        value={attendancePreviewQuery.data?.suggestedLoginTime || ""}
                        readOnly
                        placeholder="No shift"
                        className="mt-1 h-9 border-slate-200 bg-white text-sm"
                      />
                      {!attendancePreviewQuery.data?.suggestedLoginTime && attendancePreviewQuery.data && (
                        <p className="mt-1 text-xs text-amber-600">No shift start configured</p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-700">Shift Out Time</label>
                      <Input
                        type="time"
                        value={attendancePreviewQuery.data?.suggestedLogoutTime || ""}
                        readOnly
                        placeholder="No shift"
                        className="mt-1 h-9 border-slate-200 bg-white text-sm"
                      />
                      {!attendancePreviewQuery.data?.suggestedLogoutTime && attendancePreviewQuery.data && (
                        <p className="mt-1 text-xs text-amber-600">No shift end configured</p>
                      )}
                    </div>
                  </div>
                </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-dashed border-slate-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
                    Requested Correction
                  </span>
                </div>
              </div>

              {/* Requested Correction section */}
              <div className="grid gap-3 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="requestedStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Requested Attendance Status</FormLabel>
                      <Select
                        value={field.value ?? "none"}
                        onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                      >
                        <FormControl>
                          <SelectTrigger className="h-9 bg-white !text-slate-900 text-sm [&>span]:!text-slate-900">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-white !text-slate-900">
                          <SelectItem value="none">No change</SelectItem>
                          <SelectItem value="present">Present</SelectItem>
                          <SelectItem value="half_day">Half Day</SelectItem>
                          <SelectItem value="absent">Absent</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-xs">Use this if the attendance status itself is wrong.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="requestedLoginTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Requested Login Time <span className="text-rose-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="time" {...field} className="h-9 text-sm" />
                      </FormControl>
                      <FormDescription className="text-xs">At least one of login or logout is required.</FormDescription>
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
                        Requested Logout Time <span className="text-rose-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="time" {...field} className="h-9 text-sm" />
                      </FormControl>
                      <FormDescription className="text-xs">Must be after login time if both are set.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Reason */}
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => {
                  const len = field.value?.length ?? 0;
                  return (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Reason{" "}
                        <span className="text-slate-400 font-normal text-xs">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Example: forgot to punch out because the device was not responding."
                          className="min-h-[64px] text-sm"
                          {...field}
                        />
                      </FormControl>
                      <div className="flex items-center justify-between gap-3">
                        <FormDescription className="text-xs">
                          If left blank, the requested punch times will be used as the reason text.
                        </FormDescription>
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            len > 450 ? "font-semibold text-rose-500" : "text-slate-400"
                          )}
                        >
                          {len}/500
                        </span>
                      </div>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <div className="flex justify-end">
                <Button type="submit" disabled={submitMutation.isPending} className="h-9 w-full sm:w-auto text-sm">
                  {submitMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Submit Request
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">Selected Date Snapshot</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Auto-validation preview for the date currently selected in the form.
                  </p>
                </div>
                {attendancePreviewQuery.data && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                    {humanizeSource(attendancePreviewQuery.data.attendanceSource)}
                  </span>
                )}
              </div>

              <div className="mt-3">
                {attendancePreviewQuery.isLoading || attendancePreviewQuery.isFetching ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Pulling the attendance record for this date...
                  </div>
                ) : attendancePreviewQuery.isError ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                    The system record could not be loaded for this date. You can still submit the request, but the preview needs attention.
                  </div>
                ) : attendancePreviewQuery.data ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      <PreviewMetric label="Status" value={attendancePreviewQuery.data.currentStatus} />
                      <PreviewMetric label="Login Time" value={attendancePreviewQuery.data.currentLoginTime || "Not recorded"} />
                      <PreviewMetric label="Logout Time" value={attendancePreviewQuery.data.currentLogoutTime || "Not recorded"} />
                      <PreviewMetric label="Punch Count" value={String(attendancePreviewQuery.data.totalPunches)} />
                      <PreviewMetric label="Biometric Minutes" value={formatMinutesLabel(attendancePreviewQuery.data.biometricMinutes)} />
                      <PreviewMetric label="Raw Minutes" value={formatMinutesLabel(attendancePreviewQuery.data.rawMinutes)} />
                    </div>
                    {(!attendancePreviewQuery.data.currentLoginTime && !attendancePreviewQuery.data.currentLogoutTime) && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <p className="font-semibold">No attendance record found for this date</p>
                        <p className="mt-1">
                          This could mean: (1) No punch-in/out recorded, (2) Attendance not yet processed, or (3) Employee was absent.
                          The requested times below will create a new attendance record.
                        </p>
                      </div>
                    )}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                      <p className="font-semibold text-slate-900">Detected Punches</p>
                      <p className="mt-2 text-slate-600">
                        {attendancePreviewQuery.data.punches.length > 0
                          ? attendancePreviewQuery.data.punches.map((punch) => `${punch.ioLabel} ${formatDateTime(punch.punchTime)}`).join(" | ")
                          : "No punch events were found for this date."}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      <p className="font-semibold text-slate-900">Suggested Shift Window</p>
                      <p className="mt-1">
                        {attendancePreviewQuery.data.suggestedLoginTime || "--:--"} to{" "}
                        {attendancePreviewQuery.data.suggestedLogoutTime || "--:--"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                    Choose a date to load the recorded attendance snapshot.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-900">Quick note</p>
              <p className="mt-1">
                The system record is pulled automatically so the correction request only contains the actual change, not a manually copied attendance snapshot.
              </p>
            </div>
          </div>
        </div>

        {/* Requests List */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Regularization Requests</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Review request status, approval stages, audit trail, and WFM validation evidence.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
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
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 w-full md:w-44 bg-white !text-slate-900 text-sm [&>span]:!text-slate-900">
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
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            {isLoading ? (
              <div className="flex items-center gap-2 p-4 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading requests…
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No regularization requests found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Select</Th>
                      <Th>Request No</Th>
                      <Th>Date</Th>
                      <Th>Status</Th>
                      <Th>WFM Risk</Th>
                      <Th>Stage</Th>
                      <Th>Requested Time</Th>
                      <Th>Payroll</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredRequests.map((request) => {
                      const detail = getDetail(request);
                      const isSelected = selectedIds.includes(request.id);
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
                            {request.submitted_by && (
                              <div className="text-xs text-slate-500">{request.submitted_by}</div>
                            )}
                            <div className="mt-0.5 text-xs text-slate-400">
                              {formatDateTime(request.created_at)}
                            </div>
                          </Td>
                          <Td>{detail?.attendance_date || "—"}</Td>
                          <Td>
                            <StatusBadge status={request.current_status} />
                          </Td>
                          <Td>
                            <RiskBadge support={request.decision_support} />
                          </Td>
                          <Td>
                            <div className="text-slate-900">{request.current_stage_name || "—"}</div>
                            <div className="text-xs text-slate-400">
                              {request.current_owner_role || "—"}
                            </div>
                          </Td>
                          <Td>
                            <div>In: {detail?.requested_login_time || "—"}</div>
                            <div>Out: {detail?.requested_logout_time || "—"}</div>
                          </Td>
                          <Td>{request.payroll_impact_status}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                onClick={() => setSelectedRequest(request)}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                View
                              </button>
                              {["pending_manager", "pending_admin"].includes(request.current_status) && (
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
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedRequest && (
        <DetailDialog request={selectedRequest} onClose={() => setSelectedRequest(null)} />
      )}

    </DashboardLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "amber" | "sky" | "emerald" | "rose";
}) {
  const accentClass: Record<string, string> = {
    amber: "text-amber-600",
    sky: "text-sky-600",
    emerald: "text-emerald-600",
    rose: "text-rose-600",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold", accent ? accentClass[accent] : "text-slate-950")}>
        {value}
      </p>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
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
  const statusMap: Record<string, string> = {
    submitted: "pending",
    pending_manager: "pending",
    pending_admin: "pending",
    approved: "success",
    rejected: "failed",
    cancelled: "cancelled",
  };
  return (
    <SmartHRStatusBadge
      status={normalizeStatus(statusMap[status] || status)}
      label={statusLabel[status] || status}
    />
  );
}

function RiskBadge({ support }: { support?: RegularizationDecisionSupport }) {
  if (!support) return <span className="text-xs text-slate-400">No evidence</span>;
  const tone = support.riskLevel === "high"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : support.riskLevel === "medium"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return (
    <div className="space-y-1">
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold uppercase", tone)}>
        {support.riskLevel !== "low" ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
        {support.riskLevel} · {support.riskScore}
      </span>
      {support.flags.length > 0 && (
        <div className="max-w-[220px] text-xs text-slate-500">
          {support.flags.slice(0, 2).join(", ")}
          {support.flags.length > 2 ? ` +${support.flags.length - 2}` : ""}
        </div>
      )}
    </div>
  );
}

function DetailDialog({
  request,
  onClose,
}: {
  request: EmployeeRequest;
  onClose: () => void;
}) {
  const detail = request.regularization_request_detail?.[0] || null;
  const stages = [...(request.request_approval_stage || [])].sort(
    (a, b) => a.stage_no - b.stage_no
  );
  const logs = [...(request.request_action_log || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const support = request.decision_support;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              Request Detail
            </p>
            <h3 className="mt-0.5 text-lg font-semibold text-slate-950">{request.request_no}</h3>
            <div className="mt-1.5">
              <StatusBadge status={request.current_status} />
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <h4 className="text-xs font-semibold text-slate-950">Attendance Correction</h4>
            <div className="mt-3 grid gap-2 text-xs">
              <InfoRow label="Attendance Date" value={detail?.attendance_date} />
              <InfoRow label="Current Status" value={detail?.current_status} />
              <InfoRow label="Current Login" value={detail?.current_login_time} />
              <InfoRow label="Current Logout" value={detail?.current_logout_time} />
              <InfoRow label="Requested Login" value={detail?.requested_login_time} />
              <InfoRow label="Requested Logout" value={detail?.requested_logout_time} />
              <InfoRow label="Reason" value={request.reason} />
              <InfoRow label="Payroll Impact" value={request.payroll_impact_status} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <h4 className="text-xs font-semibold text-slate-950">Approval Stages</h4>
            <div className="mt-3 space-y-2">
              {stages.map((stage) => (
                <div key={stage.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-950">
                        Stage {stage.stage_no}: {stage.stage_name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Role: {stage.approver_role || "—"}
                      </p>
                    </div>
                    <StatusBadge status={stage.status} />
                  </div>
                  {stage.remarks && (
                    <p className="mt-1.5 text-xs text-slate-500">Remarks: {stage.remarks}</p>
                  )}
                  {stage.acted_at && (
                    <p className="mt-1 text-xs text-slate-400">
                      Acted at: {formatDateTime(stage.acted_at)}
                    </p>
                  )}
                </div>
              ))}
              {stages.length === 0 && (
                <p className="text-xs text-slate-400">No approval stages recorded yet.</p>
              )}
            </div>
          </div>
        </div>

        {support && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-xs font-semibold text-slate-950">WFM Validation Evidence</h4>
                <p className="mt-0.5 text-xs text-slate-500">
                  Use this before final approval. Manager approval is only the first checkpoint.
                </p>
              </div>
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
              <InfoRow label="Current LWP" value={String(support.evidence.currentLwp ?? "")} />
              <InfoRow label="First Punch" value={support.evidence.firstPunch} />
              <InfoRow label="Last Punch" value={support.evidence.lastPunch} />
              <InfoRow label="Total Punches" value={String(support.evidence.totalPunches)} />
              <InfoRow label="Biometric Minutes" value={String(support.evidence.biometricMinutes ?? "")} />
              <InfoRow label="Roster Status" value={support.evidence.rosterStatus} />
              <InfoRow label="Roster Shift" value={`${support.evidence.rosterShiftStart ?? "?"} - ${support.evidence.rosterShiftEnd ?? "?"}`} />
              <InfoRow label="Duplicate Requests" value={String(support.evidence.duplicateRequests)} />
              <InfoRow label="Recent Requests" value={String(support.evidence.recentRequests)} />
            </div>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <h4 className="text-xs font-semibold text-slate-950">Audit Log</h4>
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Action</Th>
                  <Th>Old Status</Th>
                  <Th>New Status</Th>
                  <Th>Remarks</Th>
                  <Th>Created At</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <Td>{log.action}</Td>
                    <Td>{log.old_status || "—"}</Td>
                    <Td>{log.new_status || "—"}</Td>
                    <Td>
                      <span title={log.remarks ?? undefined} className="block max-w-[200px] truncate">
                        {log.remarks || "—"}
                      </span>
                    </Td>
                    <Td>{formatDateTime(log.created_at)}</Td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td className="p-3 text-center text-xs text-slate-400" colSpan={5}>
                      No audit entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
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
