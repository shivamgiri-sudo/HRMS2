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
import { CalendarCheck, Loader2, MapPin, RefreshCw, Send } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type ReasonCode = { code: string; label: string; allowed_for: string };

type RegularizationRecord = {
  id: string;
  employee_id: string;
  session_date: string;
  requested_status: "present" | "half_day" | "absent" | null;
  reason: string;
  reason_code: string | null;
  requested_by_type: "employee" | "manager";
  branch_id: string | null;
  supporting_note: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  dispute_type: string | null;
  old_status: string | null;
  new_status: string | null;
  old_punch_in: string | null;
  old_punch_out: string | null;
  new_punch_in: string | null;
  new_punch_out: string | null;
  payroll_impact: number;
  payroll_head_approval_required: number;
  supporting_doc_id: string | null;
  escalated_to: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
  employee_name?: string;
  employee_code?: string;
  reason_label?: string;
};

// ── Constants ──────────────────────────────────────────────────────────────

const statusLabel: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const REQUESTED_STATUS_OPTIONS = [
  { value: "present", label: "Present", lwp: 0 },
  { value: "half_day", label: "Half Day", lwp: 0.5 },
  { value: "absent", label: "Absent", lwp: 1.0 },
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

// ── Zod schema ─────────────────────────────────────────────────────────────

const regularizationSchema = z
  .object({
    attendanceDate: z
      .string()
      .min(1, "Attendance date is required")
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
      .refine((d) => new Date(d + "T00:00:00") <= new Date(), "Cannot regularize a future date"),
    requestedStatus: z.enum(["present", "half_day", "absent"], { required_error: "Select requested status" }),
    reasonCode: z.string().min(1, "Select a reason"),
    currentStatus: z.string().optional(),
    currentLoginTime: z.string().optional(),
    currentLogoutTime: z.string().optional(),
    requestedLoginTime: z.string().optional(),
    requestedLogoutTime: z.string().optional(),
    disputeType: z.string().nullable().optional(),
    supportingNote: z.string().max(500, "Must be 500 characters or less").optional(),
  })
  .refine(
    (d) => {
      if (!d.requestedLoginTime || !d.requestedLogoutTime) return true;
      return d.requestedLoginTime < d.requestedLogoutTime;
    },
    { message: "Logout time must be after login time", path: ["requestedLogoutTime"] }
  );

type FormValues = z.infer<typeof regularizationSchema>;

// ── Component ──────────────────────────────────────────────────────────────

export default function AttendanceRegularization() {
  const geoCapture = useGeoCapture();
  const { toast } = useToast();
  const [requests, setRequests] = useState<RegularizationRecord[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [geoStatus, setGeoStatus] = useState<"idle" | "capturing" | "captured" | "failed">("idle");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedRequest, setSelectedRequest] = useState<RegularizationRecord | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [currentEmployeeId, setCurrentEmployeeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"mine" | "team">("mine");
  const [teamRequests, setTeamRequests] = useState<RegularizationRecord[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<RegularizationRecord | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const [searchParams] = useSearchParams();
  const linkedEmployeeId = searchParams.get("date");

  const form = useForm<FormValues>({
    resolver: zodResolver(regularizationSchema),
    defaultValues: {
      attendanceDate: new Date().toISOString().slice(0, 10),
      requestedStatus: "present",
      reasonCode: "",
      currentStatus: "",
      currentLoginTime: "",
      currentLogoutTime: "",
      requestedLoginTime: "",
      requestedLogoutTime: "",
      disputeType: null,
      supportingNote: "",
    },
  });

  const filteredRequests = useMemo(() => {
    if (filterStatus === "all") return requests;
    return requests.filter((item) => item.status === filterStatus);
  }, [requests, filterStatus]);

  const stats = useMemo(
    () => ({
      total: requests.length,
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
      cancelled: requests.filter((r) => r.status === "cancelled").length,
    }),
    [requests]
  );

  async function loadRequests() {
    setIsLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/wfm/regularizations/mine");
      const data = (res.data ?? []) as RegularizationRecord[];
      setRequests(data);
      if (data.length > 0 && !currentEmployeeId) {
        setCurrentEmployeeId(data[0].employee_id);
      }
    } catch {
      setRequests([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchAttendanceForDate(date: string) {
    if (!currentEmployeeId || !date) return;
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any }>(
        `/api/wfm/attendance/day-detail/${currentEmployeeId}/${date}`
      );
      const record = res.data?.attendance_record;
      if (record) {
        form.setValue("currentStatus", record.attendance_status || "");
        form.setValue("currentLoginTime", record.clock_in_time?.slice(0, 5) || "");
        form.setValue("currentLogoutTime", record.clock_out_time?.slice(0, 5) || "");
      }
    } catch {
      // Attendance record not available — user can fill manually
    }
  }

  async function loadTeamPending() {
    setTeamLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/wfm/regularizations?status=pending");
      setTeamRequests((res.data ?? []) as RegularizationRecord[]);
      setIsManager(true);
    } catch {
      setTeamRequests([]);
      setIsManager(false);
      setActiveTab("mine");
    } finally {
      setTeamLoading(false);
    }
  }

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, reviewerNote }: { id: string; status: "approved" | "rejected"; reviewerNote: string }) => {
      return hrmsApi.patch(`/api/wfm/regularizations/${id}/review`, { status, reviewerNote: reviewerNote || null });
    },
    onSuccess: () => {
      toast({ title: "Review submitted", description: "The regularization request has been updated." });
      setShowReviewModal(false);
      setReviewTarget(null);
      loadTeamPending();
      loadRequests();
    },
    onError: (err: any) =>
      toast({
        title: "Review failed",
        description: err?.response?.data?.error ?? err?.message ?? "Failed to submit review.",
        variant: "destructive",
      }),
  });

  async function loadReasonCodes() {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ReasonCode[] }>("/api/wfm/regularizations/reasons");
      setReasonCodes(res.data ?? []);
    } catch {
      // non-fatal
    }
  }

  const watchedDate = form.watch("attendanceDate");

  useEffect(() => {
    loadRequests();
    loadReasonCodes();
    const dateParam = searchParams.get("date");
    if (dateParam) form.setValue("attendanceDate", dateParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentEmployeeId && watchedDate) {
      fetchAttendanceForDate(watchedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEmployeeId, watchedDate]);

  useEffect(() => {
    if (activeTab === "team") {
      loadTeamPending();
    }
  }, [activeTab]);

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      setGeoStatus("capturing");
      let geo = { latitude: null as number | null, longitude: null as number | null };
      try {
        geo = await geoCapture();
        setGeoStatus("captured");
      } catch {
        setGeoStatus("failed");
      }
      return hrmsApi.post("/api/wfm/regularizations", {
        sessionDate: values.attendanceDate,
        requestedStatus: values.requestedStatus,
        reasonCode: values.reasonCode,
        reason: values.supportingNote?.trim() || values.reasonCode,
        disputeType: values.disputeType || null,
        oldStatus: values.currentStatus || null,
        oldPunchIn: values.currentLoginTime || null,
        oldPunchOut: values.currentLogoutTime || null,
        newPunchIn: values.requestedLoginTime || null,
        newPunchOut: values.requestedLogoutTime || null,
        supportingNote: values.supportingNote?.trim() || null,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
    },
    onSuccess: () => {
      form.reset({
        attendanceDate: new Date().toISOString().slice(0, 10),
        requestedStatus: "present",
        reasonCode: "",
        currentStatus: "",
        currentLoginTime: "",
        currentLogoutTime: "",
        requestedLoginTime: "",
        requestedLogoutTime: "",
        disputeType: null,
        supportingNote: "",
      });
      setGeoStatus("idle");
      setShowConfirm(false);
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

  const selectedStatus = form.watch("requestedStatus");
  const lwpValue = REQUESTED_STATUS_OPTIONS.find((o) => o.value === selectedStatus)?.lwp ?? 0;

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
            Pre-filled from link — Date:{" "}
            <span className="font-mono font-bold">{linkedEmployeeId}</span>.
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total Requests" value={stats.total} />
          <StatCard label="Pending" value={stats.pending} accent="amber" />
          <StatCard label="Approved" value={stats.approved} accent="emerald" />
          <StatCard label="Rejected" value={stats.rejected} accent="rose" />
          <StatCard label="Cancelled" value={stats.cancelled} accent="sky" />
        </div>

        {/* Submission Form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">New Regularization Request</h2>
          <p className="mt-1 text-sm text-slate-500">
            Use this form when your attendance is wrong, missing, or needs correction.
          </p>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(() => setShowConfirm(true))}
              className="mt-5 space-y-6"
            >
              {/* Row 1: Date + Requested Status */}
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
                  name="requestedStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Requested Status <span className="text-rose-500">*</span>
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REQUESTED_STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label} (LWP: {o.lwp})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        LWP impact: <span className="font-semibold">{lwpValue}</span>
                        {lwpValue > 0 && (
                          <span className="text-rose-500"> — This will affect your salary</span>
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 2: Dispute Type + Reason Code */}
              <div className="grid gap-4 md:grid-cols-2">
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
                          <SelectTrigger>
                            <SelectValue placeholder="Select dispute type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
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

                <FormField
                  control={form.control}
                  name="reasonCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Reason <span className="text-rose-500">*</span>
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a reason" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {reasonCodes.map((rc) => (
                            <SelectItem key={rc.code} value={rc.code}>
                              {rc.label}
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
                        <Input placeholder="e.g. Absent, Late In" {...field} />
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
                      <FormLabel>Requested Login Time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requestedLogoutTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Requested Logout Time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormDescription>Must be after login time if both are set.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Supporting Note */}
              <FormField
                control={form.control}
                name="supportingNote"
                render={({ field }) => {
                  const len = field.value?.length ?? 0;
                  return (
                    <FormItem>
                      <FormLabel>
                        Supporting Note{" "}
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
                        <FormDescription>Provide additional context if needed.</FormDescription>
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

              {/* Geo + Submit */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <MapPin className="h-3.5 w-3.5" />
                  {geoStatus === "idle" && <span>Location will be captured on submit</span>}
                  {geoStatus === "capturing" && <span className="text-amber-600">Capturing location…</span>}
                  {geoStatus === "captured" && <span className="text-emerald-600">Location captured</span>}
                  {geoStatus === "failed" && <span className="text-rose-500">Location unavailable</span>}
                </div>

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

        {/* Tabs: My Requests / Team Pending */}
        {isManager && (
          <div className="flex gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1 w-fit">
            <button
              onClick={() => setActiveTab("mine")}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                activeTab === "mine" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              My Requests
            </button>
            <button
              onClick={() => setActiveTab("team")}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                activeTab === "team" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Team Pending {teamRequests.length > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs text-white">{teamRequests.length}</span>}
            </button>
          </div>
        )}

        {/* My Requests */}
        {activeTab === "mine" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">My Regularization Requests</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review your past requests and their approval status.
                </p>
              </div>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-full md:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
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
                        <Th>Date</Th>
                        <Th>Requested Status</Th>
                        <Th>Reason</Th>
                        <Th>Current</Th>
                        <Th>Requested Time</Th>
                        <Th>Status</Th>
                        <Th>Actions</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredRequests.map((request) => (
                        <tr key={request.id} className="hover:bg-slate-50">
                          <Td>
                            <div className="font-medium text-slate-950">
                              {formatDate(request.session_date)}
                            </div>
                            <div className="text-xs text-slate-400">
                              {formatDateTime(request.created_at)}
                            </div>
                          </Td>
                          <Td>
                            <div className="capitalize">{request.requested_status || "—"}</div>
                          </Td>
                          <Td>
                            <div className="text-slate-900">{request.reason_label || request.reason_code || "—"}</div>
                            <div className="max-w-[200px] truncate text-xs text-slate-400" title={request.reason}>
                              {request.reason}
                            </div>
                          </Td>
                          <Td>
                            <div className="text-xs">
                              <span className="text-slate-400">Status:</span> {request.old_status || "—"}
                            </div>
                            <div className="text-xs text-slate-400">
                              {request.old_punch_in || "?"} → {request.old_punch_out || "?"}
                            </div>
                          </Td>
                          <Td>
                            <div>
                              {request.new_punch_in || "—"} → {request.new_punch_out || "—"}
                            </div>
                          </Td>
                          <Td>
                            <StatusBadge status={request.status} />
                          </Td>
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
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Team Pending */}
        {activeTab === "team" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Team Pending Regularizations</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {teamRequests.length} request{teamRequests.length !== 1 ? "s" : ""} pending your review.
                </p>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
              {teamLoading ? (
                <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading team requests…
                </div>
              ) : teamRequests.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No pending team regularization requests.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Employee</Th>
                        <Th>Date</Th>
                        <Th>Requested</Th>
                        <Th>Reason</Th>
                        <Th>Current → Requested</Th>
                        <Th>Pending For</Th>
                        <Th>Actions</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {teamRequests.map((request) => (
                        <tr key={request.id} className="hover:bg-slate-50">
                          <Td>
                            <div className="font-medium text-slate-950">{request.employee_name || "—"}</div>
                            <div className="text-xs text-slate-400">{request.employee_code || "—"}</div>
                          </Td>
                          <Td>{formatDate(request.session_date)}</Td>
                          <Td>
                            <span className="capitalize">{request.requested_status || "—"}</span>
                          </Td>
                          <Td>
                            <div className="text-slate-900">{request.reason_label || request.reason_code || "—"}</div>
                            <div className="max-w-[180px] truncate text-xs text-slate-400" title={request.reason}>
                              {request.reason}
                            </div>
                          </Td>
                          <Td>
                            <div className="text-xs text-slate-400">
                              {request.old_punch_in || "?"} → {request.old_punch_out || "?"}
                            </div>
                            <div className="text-xs font-medium text-teal-600">
                              {request.new_punch_in || "—"} → {request.new_punch_out || "—"}
                            </div>
                          </Td>
                          <Td>
                            <span className="text-xs text-slate-500">{daysSince(request.created_at)}</span>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  setReviewTarget(request);
                                  setShowReviewModal(true);
                                }}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => {
                                  setReviewTarget(request);
                                  setShowReviewModal(true);
                                }}
                                className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                              >
                                Reject
                              </button>
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      {showConfirm && (
        <ConfirmDialog
          onConfirm={() => {
            const values = form.getValues();
            submitMutation.mutate(values);
          }}
          onCancel={() => setShowConfirm(false)}
          lwpValue={lwpValue}
          isPending={submitMutation.isPending}
        />
      )}

      {/* Review Modal */}
      {showReviewModal && reviewTarget && (
        <ReviewDialog
          request={reviewTarget}
          onClose={() => { setShowReviewModal(false); setReviewTarget(null); }}
          onReview={(id, status, reviewerNote) => reviewMutation.mutate({ id, status, reviewerNote })}
          isPending={reviewMutation.isPending}
        />
      )}

      {/* Detail Modal */}
      {selectedRequest && (
        <DetailDialog request={selectedRequest} onClose={() => setSelectedRequest(null)} />
      )}
    </DashboardLayout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

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
    pending: "pending",
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

function ReviewDialog({
  request,
  onClose,
  onReview,
  isPending,
}: {
  request: RegularizationRecord;
  onClose: () => void;
  onReview: (id: string, status: "approved" | "rejected", reviewerNote: string) => void;
  isPending: boolean;
}) {
  const [reviewerNote, setReviewerNote] = useState("");
  const [selectedAction, setSelectedAction] = useState<"approved" | "rejected" | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  if (confirmStep && selectedAction) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-slate-950">
            {selectedAction === "approved" ? "Approve" : "Reject"} Regularization
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            {selectedAction === "approved"
              ? "This will update the employee's attendance record. Are you sure?"
              : "The employee will be notified of the rejection."}
          </p>
          {reviewerNote && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Note: {reviewerNote}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={() => setConfirmStep(false)}
              disabled={isPending}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <Button
              onClick={() => onReview(request.id, selectedAction, reviewerNote)}
              disabled={isPending}
              variant={selectedAction === "approved" ? "default" : "destructive"}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {selectedAction === "approved" ? "Approving…" : "Rejecting…"}
                </>
              ) : (
                selectedAction === "approved" ? "Confirm Approve" : "Confirm Reject"
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">Review Regularization</h3>
            <p className="mt-1 text-sm text-slate-500">
              {request.employee_name} — {formatDate(request.session_date)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="text-slate-500">Requested Status</div>
            <div className="font-medium capitalize">{request.requested_status || "—"}</div>
            <div className="text-slate-500">Reason</div>
            <div>{request.reason_label || request.reason_code || "—"}</div>
            <div className="text-slate-500">Current Punch</div>
            <div>{request.old_punch_in || "?"} → {request.old_punch_out || "?"}</div>
            <div className="text-slate-500">Requested Punch</div>
            <div className="font-medium text-teal-600">{request.new_punch_in || "—"} → {request.new_punch_out || "—"}</div>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-sm font-medium text-slate-700">Reviewer Note <span className="text-slate-400 font-normal">(optional)</span></label>
          <textarea
            value={reviewerNote}
            onChange={(e) => setReviewerNote(e.target.value)}
            placeholder="Add a note explaining your decision…"
            className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 min-h-[72px] resize-none"
          />
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={() => { setSelectedAction("rejected"); setConfirmStep(true); }}
            disabled={isPending}
            className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
          >
            Reject
          </button>
          <button
            onClick={() => { setSelectedAction("approved"); setConfirmStep(true); }}
            disabled={isPending}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  onConfirm,
  onCancel,
  lwpValue,
  isPending,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  lwpValue: number;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-950">Confirm Submission</h3>
        {lwpValue > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            This request will result in <strong>LWP of {lwpValue}</strong>, which may affect your
            salary.
          </div>
        )}
        <p className="mt-3 text-sm text-slate-600">
          Are you sure you want to submit this regularization request?
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Confirm & Submit"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailDialog({
  request,
  onClose,
}: {
  request: RegularizationRecord;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              Request Detail
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">
              {formatDate(request.session_date)}
            </h3>
            <div className="mt-2">
              <StatusBadge status={request.status} />
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
              <InfoRow label="Session Date" value={formatDate(request.session_date)} />
              <InfoRow label="Requested Status" value={request.requested_status ? capitalize(request.requested_status) : "—"} />
              <InfoRow label="Reason Code" value={request.reason_label || request.reason_code || "—"} />
              <InfoRow label="Reason" value={request.reason} />
              <InfoRow label="Supporting Note" value={request.supporting_note} />
              <InfoRow label="Old Status" value={request.old_status} />
              <InfoRow label="Old Punch" value={request.old_punch_in && request.old_punch_out ? `${request.old_punch_in} → ${request.old_punch_out}` : "—"} />
              <InfoRow label="New Punch" value={request.new_punch_in && request.new_punch_out ? `${request.new_punch_in} → ${request.new_punch_out}` : "—"} />
              <InfoRow label="Dispute Type" value={request.dispute_type ? capitalize(request.dispute_type.replace(/_/g, " ")) : "—"} />
              <InfoRow label="Payroll Impact" value={request.payroll_impact ? "Yes" : "No"} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-950">Review & Status</h4>
            <div className="mt-4 grid gap-3 text-sm">
              <InfoRow label="Requested By" value={request.requested_by_type === "manager" ? "Manager" : "Employee"} />
              <InfoRow label="Submitted By" value={request.employee_name ? `${request.employee_name} (${request.employee_code || ""})` : "—"} />
              <InfoRow label="Status" value={statusLabel[request.status] || request.status} />
              <InfoRow label="Reviewed By" value={request.reviewed_by || "—"} />
              <InfoRow label="Reviewed At" value={formatDateTime(request.reviewed_at)} />
              <InfoRow label="Reviewer Note" value={request.reviewer_note} />
              <InfoRow label="Created At" value={formatDateTime(request.created_at)} />
              <InfoRow label="Updated At" value={formatDateTime(request.updated_at)} />
              <InfoRow label="Location" value={request.latitude && request.longitude ? `${request.latitude}, ${request.longitude}` : "—"} />
            </div>
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

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value + "T00:00:00"));
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function daysSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
