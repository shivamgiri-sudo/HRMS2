import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useGeoCapture } from "@/hooks/useGeoCapture";
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
import { AlertTriangle, CalendarCheck, CheckCircle2, Loader2, RefreshCw, Send, XCircle } from "lucide-react";
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

const CURRENT_STATUS_OPTIONS = [
  { value: "Absent", label: "Absent" },
  { value: "Present", label: "Present" },
  { value: "Half Day", label: "Half Day" },
  { value: "Missing Punch", label: "Missing Punch" },
  { value: "Late In", label: "Late In" },
  { value: "Early Out", label: "Early Out" },
];

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
      disputeType: null,
      reason: "",
    },
  });

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
      form.reset({
        attendanceDate: new Date().toISOString().slice(0, 10),
        currentStatus: "Absent",
        currentLoginTime: "",
        currentLogoutTime: "",
        requestedLoginTime: "09:30",
        requestedLogoutTime: "18:30",
        disputeType: null,
        reason: "",
      });
      toast({ title: "Request submitted", description: "Your regularization request has been recorded." });
      loadRequests();
    },
    onError: (err: any) =>
      toast({
        title: "Submission failed",
        description: err?.response?.data?.error ?? err?.message ?? "Failed to submit.",
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
    onError: (err: any) =>
      toast({
        title: "Review failed",
        description: err?.response?.data?.message ?? err?.message ?? "Failed to review request.",
        variant: "destructive",
      }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => hrmsApi.patch("/api/wfm/regularizations/bulk-review", { ids, status: "approved" }),
    onSuccess: () => {
      toast({ title: "Bulk approval completed", description: "Low-risk WFM-ready requests were processed." });
      setSelectedIds([]);
      loadRequests();
    },
    onError: (err: any) =>
      toast({
        title: "Bulk approval failed",
        description: err?.response?.data?.message ?? err?.message ?? "Failed to bulk approve.",
        variant: "destructive",
      }),
  });

  function getDetail(request: EmployeeRequest) {
    return request.regularization_request_detail?.[0] || null;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="rounded-3xl bg-gradient-to-r from-green-600 to-teal-600 p-6 text-white">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CalendarCheck className="h-10 w-10" />
              <div>
                <h1 className="text-3xl font-black">Attendance Regularization</h1>
                <p className="mt-1 text-sm opacity-90">
                  Submit attendance correction requests and track their approval status.
                </p>
              </div>
            </div>
            <button
              onClick={loadRequests}
              className="flex items-center gap-2 rounded-xl border border-white/30 bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {linkedEmployeeId && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Deep-linked from notification — Employee ID:{" "}
            <span className="font-mono font-bold">{linkedEmployeeId}</span>. The date below has been
            pre-filled.
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total Requests" value={stats.total} />
          <StatCard label="Pending Manager" value={stats.pendingManager} accent="amber" />
          <StatCard label="Pending Admin" value={stats.pendingAdmin} accent="sky" />
          <StatCard label="Approved" value={stats.approved} accent="emerald" />
          <StatCard label="High Risk" value={stats.risky} accent="rose" />
        </div>

        {/* Submission Form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">New Regularization Request</h2>
          <p className="mt-1 text-sm text-slate-500">
            Use this form when your attendance is wrong, missing, or needs correction.
          </p>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => submitMutation.mutate(v))}
              className="mt-5 space-y-6"
            >
              {/* Row 1: Date + Dispute Type */}
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="attendanceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Attendance Date <span className="text-rose-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormDescription>Cannot be a future date.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="disputeType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Dispute Type{" "}
                        <span className="text-slate-400 font-normal text-xs">(optional)</span>
                      </FormLabel>
                      <Select
                        value={field.value ?? "none"}
                        onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                      >
                        <FormControl>
                          <SelectTrigger className="bg-white !text-slate-900 [&>span]:!text-slate-900">
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

              {/* Current Attendance section */}
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">
                  Current Attendance (as recorded)
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="currentStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Status</FormLabel>
                        <Select value={field.value ?? ""} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="bg-white !text-slate-900 [&>span]:!text-slate-900">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="bg-white !text-slate-900">
                            {CURRENT_STATUS_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="currentLoginTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Login Time</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} />
                        </FormControl>
                        <FormDescription>24-hour format</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="currentLogoutTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Logout Time</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} />
                        </FormControl>
                        <FormDescription>24-hour format</FormDescription>
                        <FormMessage />
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
                  <span className="bg-white px-3 text-xs font-bold uppercase tracking-widest text-teal-600">
                    Requested Correction
                  </span>
                </div>
              </div>

              {/* Requested Correction section */}
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="requestedLoginTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Requested Login Time <span className="text-rose-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormDescription>At least one of login/logout is required.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requestedLogoutTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Requested Logout Time <span className="text-rose-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormDescription>Must be after login time if both are set.</FormDescription>
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
                      <FormLabel>
                        Reason{" "}
                        <span className="text-slate-400 font-normal text-xs">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="E.g. Forgot to punch out due to system issue."
                          className="min-h-[88px]"
                          {...field}
                        />
                      </FormControl>
                      <div className="flex items-center justify-between">
                        <FormDescription>
                          If left blank, the requested times will be used as the reason.
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
                <Button type="submit" disabled={submitMutation.isPending} className="w-full sm:w-auto">
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

        {/* Requests List */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Regularization Requests</h2>
              <p className="mt-1 text-sm text-slate-500">
                Review request status, approval stages, and audit trail.
              </p>
            </div>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full md:w-52 bg-white !text-slate-900 [&>span]:!text-slate-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white !text-slate-900">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending_manager">Pending Manager</SelectItem>
                <SelectItem value="pending_admin">Pending Admin / WFM</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            {isLoading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading requests…
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No regularization requests found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Request No</Th>
                      <Th>Date</Th>
                      <Th>Status</Th>
                      <Th>Stage</Th>
                      <Th>Requested Time</Th>
                      <Th>Payroll</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredRequests.map((request) => {
                      const detail = getDetail(request);
                      return (
                        <tr key={request.id} className="hover:bg-slate-50">
                          <Td>
                            <div className="font-semibold text-slate-950">{request.request_no}</div>
                            <div className="mt-0.5 text-xs text-slate-400">
                              {formatDateTime(request.created_at)}
                            </div>
                          </Td>
                          <Td>{detail?.attendance_date || "—"}</Td>
                          <Td>
                            <StatusBadge status={request.current_status} />
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
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => setSelectedRequest(request)}
                                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                View
                              </button>

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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold", accent ? accentClass[accent] : "text-slate-950")}>
        {value}
      </p>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3 text-slate-600">{children}</td>;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              Request Detail
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">{request.request_no}</h3>
            <div className="mt-2">
              <StatusBadge status={request.current_status} />
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-950">Attendance Correction</h4>
            <div className="mt-4 grid gap-3 text-sm">
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

          <div className="rounded-2xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-950">Approval Stages</h4>
            <div className="mt-4 space-y-3">
              {stages.map((stage) => (
                <div key={stage.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        Stage {stage.stage_no}: {stage.stage_name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Role: {stage.approver_role || "—"}
                      </p>
                    </div>
                    <StatusBadge status={stage.status} />
                  </div>
                  {stage.remarks && (
                    <p className="mt-2 text-xs text-slate-500">Remarks: {stage.remarks}</p>
                  )}
                  {stage.acted_at && (
                    <p className="mt-1 text-xs text-slate-400">
                      Acted at: {formatDateTime(stage.acted_at)}
                    </p>
                  )}
                </div>
              ))}
              {stages.length === 0 && (
                <p className="text-sm text-slate-400">No approval stages recorded yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-950">Audit Log</h4>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
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
                    <td className="p-4 text-center text-sm text-slate-400" colSpan={5}>
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
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
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
  }).format(new Date(value));
}
