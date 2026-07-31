/**
 * Attendance Disputes Governance Page — Complete Redesign
 *
 * Multi-role command center for formal attendance dispute review.
 * Features: stat cards, filters, inline actions, detail drawer, proper endpoint routing.
 */

import { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { useCanDiscard } from "@/hooks/useDiscard";
import { DiscardDialog } from "@/components/discard/DiscardDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  Send,
  ShieldAlert,
  User,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Dispute {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  session_date: string;
  dispute_type: string | null;
  old_status: string | null;
  new_status: string | null;
  old_punch_in: string | null;
  old_punch_out: string | null;
  new_punch_in: string | null;
  new_punch_out: string | null;
  payroll_impact: number;
  payroll_head_approval_required: number;
  payroll_head_approved_by: string | null;
  payroll_head_approved_at: string | null;
  status: string;
  escalated_to: string | null;
  escalated_at: string | null;
  reason: string;
  reason_code: string | null;
  reason_label: string | null;
  reviewer_note: string | null;
  supporting_doc_id: string | null;
  supporting_note: string | null;
  branch_name: string | null;
  process_name: string | null;
  created_at: string;
  reviewed_at: string | null;
  current_attendance_status?: string | null;
  current_lwp?: number | null;
  current_clock_in?: string | null;
  current_clock_out?: string | null;
  audit_timeline?: AuditEvent[];
}

interface AuditEvent {
  id: string;
  action_type: string;
  actor_role: string;
  reason: string | null;
  acted_at: string;
  old_value_json?: Record<string, unknown>;
  new_value_json?: Record<string, unknown>;
}

interface QueueCounts {
  my: number;
  manager: number;
  hr: number;
  payroll: number;
  resolved_this_month: number;
}

type QueueType = "my" | "manager" | "hr" | "payroll";
type ActionType = "approve" | "reject" | "escalate_to_hr" | "escalate_to_payroll" | "send_back";

// ─── Constants ───────────────────────────────────────────────────────────────

const DISPUTE_TYPE_LABELS: Record<string, string> = {
  missing_punch: "Missing Punch",
  wrong_punch: "Wrong Punch",
  late_mark_dispute: "Late Mark",
  early_logout_dispute: "Early Logout",
  half_day_dispute: "Half Day",
  absent_wrongly_marked: "Wrongly Marked Absent",
  week_off_worked: "Week Off Worked",
  holiday_worked: "Holiday Worked",
  shift_mismatch: "Shift Mismatch",
  cosec_sync_issue: "COSEC Sync Issue",
  manual_punch_correction: "Manual Correction",
  work_from_home: "WFH Exception",
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-100 text-amber-800 border-amber-200" },
  submitted: { label: "Submitted", className: "bg-amber-100 text-amber-800 border-amber-200" },
  manager_approved: { label: "Manager Approved", className: "bg-blue-100 text-blue-800 border-blue-200" },
  escalated: { label: "Escalated", className: "bg-purple-100 text-purple-800 border-purple-200" },
  escalated_to_hr: { label: "Escalated to HR", className: "bg-purple-100 text-purple-800 border-purple-200" },
  escalated_to_payroll: { label: "Escalated to Payroll", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-800 border-red-200" },
  discarded: { label: "Discarded", className: "bg-slate-100 text-slate-700 border-slate-300" },
};

const PAGE_SIZE = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return "—";
  if (timeStr.includes("T")) {
    return formatDateTime(timeStr).split(",")[1]?.trim() ?? timeStr;
  }
  return timeStr;
}

function getStatusBadge(status: string, escalatedTo?: string | null) {
  let key = status;
  if (status === "escalated" && escalatedTo === "hr") key = "escalated_to_hr";
  if (status === "escalated" && escalatedTo === "payroll_head") key = "escalated_to_payroll";
  const config = STATUS_CONFIG[key] ?? { label: status, className: "bg-gray-100 text-gray-800" };
  return <Badge variant="outline" className={cn("text-xs font-medium", config.className)}>{config.label}</Badge>;
}

// ─── Stat Card Component ─────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, accent = "slate" }: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  accent?: "amber" | "blue" | "purple" | "emerald" | "slate";
}) {
  const accentClasses = {
    amber: "text-amber-600 bg-amber-50",
    blue: "text-blue-600 bg-blue-50",
    purple: "text-purple-600 bg-purple-50",
    emerald: "text-emerald-600 bg-emerald-50",
    slate: "text-slate-600 bg-slate-50",
  };
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", accentClasses[accent])}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function NativeAttendanceDisputes() {
  const { toast } = useToast();

  // State
  const [activeQueue, setActiveQueue] = useState<QueueType>("manager");
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<QueueCounts>({ my: 0, manager: 0, hr: 0, payroll: 0, resolved_this_month: 0 });

  // Filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [disputeType, setDisputeType] = useState<string>("all");
  const [payrollImpactFilter, setPayrollImpactFilter] = useState<string>("all");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);

  // Detail drawer
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);

  // super_admin / wfm only — narrower than the approval queues above.
  const { canDiscard } = useCanDiscard();
  const [discardDisputeId, setDiscardDisputeId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Action dialog
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ queue: activeQueue });
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      if (disputeType && disputeType !== "all") params.set("disputeType", disputeType);
      if (payrollImpactFilter === "yes") params.set("payrollImpact", "1");
      if (payrollImpactFilter === "no") params.set("payrollImpact", "0");

      const resp = await hrmsApi.get<{ success: boolean; data: Dispute[]; error?: string }>(
        `/api/attendance/disputes?${params.toString()}`
      );

      if (resp.success) {
        let filtered = resp.data || [];
        if (employeeSearch.trim()) {
          const search = employeeSearch.toLowerCase();
          filtered = filtered.filter(
            d => d.employee_name?.toLowerCase().includes(search) ||
                 d.employee_code?.toLowerCase().includes(search)
          );
        }
        setDisputes(filtered);
        setPage(1);
      } else {
        toast({ title: "Error", description: resp.error || "Failed to load disputes", variant: "destructive" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading disputes";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [activeQueue, fromDate, toDate, disputeType, payrollImpactFilter, employeeSearch, toast]);

  const fetchCounts = useCallback(async () => {
    try {
      const [myResp, managerResp, hrResp, payrollResp] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: Dispute[] }>("/api/attendance/disputes?queue=my"),
        hrmsApi.get<{ success: boolean; data: Dispute[] }>("/api/attendance/disputes?queue=manager"),
        hrmsApi.get<{ success: boolean; data: Dispute[] }>("/api/attendance/disputes?queue=hr"),
        hrmsApi.get<{ success: boolean; data: Dispute[] }>("/api/attendance/disputes?queue=payroll"),
      ]);
      setCounts({
        my: myResp.success ? (myResp.data?.length ?? 0) : 0,
        manager: managerResp.success ? (managerResp.data?.length ?? 0) : 0,
        hr: hrResp.success ? (hrResp.data?.length ?? 0) : 0,
        payroll: payrollResp.success ? (payrollResp.data?.length ?? 0) : 0,
        resolved_this_month: 0,
      });
    } catch {
      // Silently fail on count fetch
    }
  }, []);

  const fetchDisputeDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const resp = await hrmsApi.get<{ success: boolean; data: Dispute; error?: string }>(
        `/api/attendance/disputes/${id}`
      );
      if (resp.success && resp.data) {
        setSelectedDispute(resp.data);
      }
    } catch {
      // Detail fetch failed, keep list data
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // ─── Action Handler (FIXED endpoint routing) ───────────────────────────────

  const handleAction = async () => {
    if (!selectedDispute || !actionType) return;
    if (!actionReason.trim() && actionType !== "approve") {
      toast({ title: "Reason Required", description: "Please provide a reason for this action", variant: "destructive" });
      return;
    }

    setActionInProgress(true);
    try {
      let endpoint = "";

      // CRITICAL: Route to correct endpoint based on action AND current queue
      if (activeQueue === "manager") {
        // Manager queue → manager-action endpoint
        endpoint = `/api/attendance/disputes/${selectedDispute.id}/manager-action`;
      } else if (activeQueue === "hr") {
        // HR queue → hr-action endpoint for all HR actions
        if (actionType === "approve" || actionType === "reject" || actionType === "escalate_to_payroll") {
          endpoint = `/api/attendance/disputes/${selectedDispute.id}/hr-action`;
        } else {
          endpoint = `/api/attendance/disputes/${selectedDispute.id}/hr-action`;
        }
      } else if (activeQueue === "payroll") {
        // Payroll queue → payroll-action endpoint
        endpoint = `/api/attendance/disputes/${selectedDispute.id}/payroll-action`;
      } else {
        // My queue — no actions allowed
        toast({ title: "Error", description: "Cannot perform actions from My Disputes tab", variant: "destructive" });
        return;
      }

      const resp = await hrmsApi.post<{ success: boolean; error?: string; message?: string }>(
        endpoint,
        { action: actionType, reason: actionReason.trim() || "Approved" }
      );

      if (resp.success) {
        toast({
          title: "Success",
          description: resp.message || `Dispute ${actionType} successfully`,
          className: "bg-emerald-50 border-emerald-200",
        });
        setSelectedDispute(null);
        setActionType(null);
        setActionReason("");
        await fetchDisputes();
        await fetchCounts();
      } else {
        toast({ title: "Action Failed", description: resp.error || "Failed to perform action", variant: "destructive" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error performing action";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setActionInProgress(false);
    }
  };

  // ─── Pagination ────────────────────────────────────────────────────────────

  const paginatedDisputes = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return disputes.slice(start, start + PAGE_SIZE);
  }, [disputes, page]);

  const totalPages = Math.ceil(disputes.length / PAGE_SIZE);

  // ─── Clear Filters ─────────────────────────────────────────────────────────

  const clearFilters = () => {
    setFromDate("");
    setToDate("");
    setDisputeType("all");
    setPayrollImpactFilter("all");
    setEmployeeSearch("");
  };

  const hasActiveFilters = fromDate || toDate || disputeType !== "all" || payrollImpactFilter !== "all" || employeeSearch;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout pageTitle="Attendance Disputes">
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 rounded-2xl p-6 text-white">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm">
                <Scale className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Attendance Disputes</h1>
                <p className="text-slate-300 text-sm mt-1">
                  Review and resolve formal attendance disputes requiring governance approval
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { fetchDisputes(); fetchCounts(); }}
              className="bg-white/10 hover:bg-white/20 text-white border-0"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Manager Queue" value={counts.manager} icon={User} accent="amber" />
          <StatCard label="HR Queue" value={counts.hr} icon={ShieldAlert} accent="blue" />
          <StatCard label="Payroll Queue" value={counts.payroll} icon={AlertTriangle} accent="purple" />
          <StatCard label="My Disputes" value={counts.my} icon={FileText} accent="slate" />
        </div>

        {/* Filters Bar */}
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant={showFilters ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                Filters
                {hasActiveFilters && <Badge variant="secondary" className="ml-1 h-5 px-1.5">{
                  [fromDate, toDate, disputeType !== "all", payrollImpactFilter !== "all", employeeSearch].filter(Boolean).length
                }</Badge>}
              </Button>

              <div className="flex-1 max-w-xs">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search employee..."
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </div>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-slate-500">
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}

              <div className="ml-auto text-sm text-slate-500">
                {disputes.length} dispute{disputes.length !== 1 ? "s" : ""}
              </div>
            </div>

            {showFilters && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1.5 block">From Date</label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1.5 block">To Date</label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1.5 block">Dispute Type</label>
                  <Select value={disputeType} onValueChange={setDisputeType}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {Object.entries(DISPUTE_TYPE_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1.5 block">Payroll Impact</label>
                  <Select value={payrollImpactFilter} onValueChange={setPayrollImpactFilter}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="yes">Has Impact</SelectItem>
                      <SelectItem value="no">No Impact</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeQueue} onValueChange={(v) => setActiveQueue(v as QueueType)}>
          <TabsList className="bg-slate-100 p-1">
            <TabsTrigger value="my" className="gap-2 data-[state=active]:bg-white">
              My Disputes
              {counts.my > 0 && <Badge variant="secondary" className="h-5 px-1.5">{counts.my}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="manager" className="gap-2 data-[state=active]:bg-white">
              Manager Queue
              {counts.manager > 0 && <Badge variant="secondary" className="h-5 px-1.5 bg-amber-100 text-amber-700">{counts.manager}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="hr" className="gap-2 data-[state=active]:bg-white">
              HR/WFM Queue
              {counts.hr > 0 && <Badge variant="secondary" className="h-5 px-1.5 bg-blue-100 text-blue-700">{counts.hr}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="payroll" className="gap-2 data-[state=active]:bg-white">
              Payroll Queue
              {counts.payroll > 0 && <Badge variant="secondary" className="h-5 px-1.5 bg-purple-100 text-purple-700">{counts.payroll}</Badge>}
            </TabsTrigger>
          </TabsList>

          {["my", "manager", "hr", "payroll"].map((queue) => (
            <TabsContent key={queue} value={queue} className="mt-4">
              {loading ? (
                <Card>
                  <CardContent className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                  </CardContent>
                </Card>
              ) : disputes.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-16">
                    <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
                    <p className="text-lg font-medium text-slate-700">
                      {queue === "my" ? "You have no disputes" : "Queue is clear"}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                      {queue === "my"
                        ? "Your attendance dispute requests will appear here"
                        : "No disputes pending in this queue"}
                    </p>
                    {queue === "my" && (
                      <Link to="/attendance-regularization">
                        <Button variant="outline" className="mt-4">
                          Raise Regularization Request
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50/50">
                            <TableHead className="font-semibold">Employee</TableHead>
                            <TableHead className="font-semibold">Date</TableHead>
                            <TableHead className="font-semibold">Type</TableHead>
                            <TableHead className="font-semibold">Change</TableHead>
                            <TableHead className="font-semibold">Branch</TableHead>
                            <TableHead className="font-semibold">Status</TableHead>
                            <TableHead className="font-semibold">Payroll</TableHead>
                            <TableHead className="font-semibold text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedDisputes.map((dispute) => (
                            <TableRow
                              key={dispute.id}
                              className="cursor-pointer hover:bg-slate-50/50"
                              onClick={() => {
                                setSelectedDispute(dispute);
                                fetchDisputeDetail(dispute.id);
                              }}
                            >
                              <TableCell>
                                <div>
                                  <p className="font-medium text-slate-900">{dispute.employee_name}</p>
                                  <p className="text-xs text-slate-500">{dispute.employee_code}</p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2 text-sm">
                                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                                  {formatDate(dispute.session_date)}
                                </div>
                              </TableCell>
                              <TableCell>
                                {dispute.dispute_type ? (
                                  <Badge variant="outline" className="text-xs">
                                    {DISPUTE_TYPE_LABELS[dispute.dispute_type] ?? dispute.dispute_type}
                                  </Badge>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <span className="text-sm">
                                  <span className="text-slate-500">{dispute.old_status ?? "—"}</span>
                                  <span className="mx-1.5 text-slate-300">→</span>
                                  <span className="font-medium text-slate-700">{dispute.new_status ?? dispute.requested_status ?? "—"}</span>
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm text-slate-600">{dispute.branch_name ?? "—"}</span>
                              </TableCell>
                              <TableCell>
                                {getStatusBadge(dispute.status, dispute.escalated_to)}
                              </TableCell>
                              <TableCell>
                                {dispute.payroll_impact ? (
                                  <Badge variant="destructive" className="text-xs gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    Impact
                                  </Badge>
                                ) : (
                                  <span className="text-slate-400 text-sm">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                {queue !== "my" && !["approved", "rejected"].includes(dispute.status) && (
                                  <div className="flex items-center justify-end gap-1">
                                    {/* Inline approve for non-payroll-impact items */}
                                    {!dispute.payroll_impact && !dispute.payroll_head_approval_required && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedDispute(dispute);
                                          setActionType("approve");
                                        }}
                                      >
                                        <Check className="h-4 w-4" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedDispute(dispute);
                                        setActionType("reject");
                                      }}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                    {queue === "manager" && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedDispute(dispute);
                                          setActionType("escalate_to_hr");
                                        }}
                                        title="Escalate to HR"
                                      >
                                        <Send className="h-4 w-4" />
                                      </Button>
                                    )}
                                    {queue === "hr" && dispute.payroll_impact && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedDispute(dispute);
                                          setActionType("escalate_to_payroll");
                                        }}
                                        title="Escalate to Payroll"
                                      >
                                        <Send className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                )}
                                {/* Reversing an already-approved dispute is a
                                    different operation from the approval
                                    workflow, so it does not go through
                                    handleAction's manager/hr/payroll endpoints. */}
                                {dispute.status === "approved" && canDiscard && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDiscardDisputeId(dispute.id);
                                    }}
                                    title="Discard this approved dispute"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                        <p className="text-sm text-slate-500">
                          Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, disputes.length)} of {disputes.length}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="text-sm text-slate-600">
                            Page {page} of {totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Detail Drawer */}
      <Sheet open={!!selectedDispute && !actionType} onOpenChange={(open) => !open && setSelectedDispute(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedDispute && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <Scale className="h-5 w-5 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">Dispute Details</p>
                    <p className="text-sm font-normal text-slate-500">
                      {selectedDispute.employee_code} • {formatDate(selectedDispute.session_date)}
                    </p>
                  </div>
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Employee Info */}
                <div className="bg-slate-50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Employee Information</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-500">Name</p>
                      <p className="font-medium">{selectedDispute.employee_name}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Code</p>
                      <p className="font-medium">{selectedDispute.employee_code}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Branch</p>
                      <p className="font-medium">{selectedDispute.branch_name ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Process</p>
                      <p className="font-medium">{selectedDispute.process_name ?? "—"}</p>
                    </div>
                  </div>
                </div>

                {/* Dispute Details */}
                <div className="bg-slate-50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Dispute Information</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Date</span>
                      <span className="font-medium">{formatDate(selectedDispute.session_date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Type</span>
                      <Badge variant="outline">
                        {selectedDispute.dispute_type
                          ? DISPUTE_TYPE_LABELS[selectedDispute.dispute_type] ?? selectedDispute.dispute_type
                          : "Regularization"}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Status</span>
                      {getStatusBadge(selectedDispute.status, selectedDispute.escalated_to)}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Status Change</span>
                      <span>
                        <span className="text-slate-500">{selectedDispute.old_status ?? "—"}</span>
                        <span className="mx-1.5">→</span>
                        <span className="font-medium">{selectedDispute.new_status ?? selectedDispute.requested_status ?? "—"}</span>
                      </span>
                    </div>
                    {selectedDispute.payroll_impact ? (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Payroll Impact</span>
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Yes
                        </Badge>
                      </div>
                    ) : null}
                    <div className="flex justify-between">
                      <span className="text-slate-500">Created</span>
                      <span className="font-medium">{formatDateTime(selectedDispute.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Punch Times */}
                {(selectedDispute.old_punch_in || selectedDispute.new_punch_in) && (
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Punch Times</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-slate-500 mb-1">Original</p>
                        <p className="font-medium">
                          {formatTime(selectedDispute.old_punch_in)} - {formatTime(selectedDispute.old_punch_out)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 mb-1">Requested</p>
                        <p className="font-medium">
                          {formatTime(selectedDispute.new_punch_in)} - {formatTime(selectedDispute.new_punch_out)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Current Attendance State */}
                {(selectedDispute.current_attendance_status || selectedDispute.current_clock_in) && (
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                    <h3 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Current Attendance Record
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-amber-700">Status</p>
                        <p className="font-medium text-amber-900">{selectedDispute.current_attendance_status ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-amber-700">LWP</p>
                        <p className="font-medium text-amber-900">{selectedDispute.current_lwp ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-amber-700">Clock In</p>
                        <p className="font-medium text-amber-900">{formatTime(selectedDispute.current_clock_in)}</p>
                      </div>
                      <div>
                        <p className="text-amber-700">Clock Out</p>
                        <p className="font-medium text-amber-900">{formatTime(selectedDispute.current_clock_out)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Reason */}
                <div className="bg-slate-50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Reason</h3>
                  <p className="text-sm text-slate-600">
                    {selectedDispute.reason_label ?? selectedDispute.reason ?? "No reason provided"}
                  </p>
                  {selectedDispute.supporting_note && (
                    <p className="text-sm text-slate-500 mt-2 italic">
                      Note: {selectedDispute.supporting_note}
                    </p>
                  )}
                </div>

                {/* Reviewer Note */}
                {selectedDispute.reviewer_note && (
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                    <h3 className="text-sm font-semibold text-blue-800 mb-2">Reviewer Note</h3>
                    <p className="text-sm text-blue-700">{selectedDispute.reviewer_note}</p>
                  </div>
                )}

                {/* Audit Timeline */}
                {selectedDispute.audit_timeline && selectedDispute.audit_timeline.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Audit Timeline</h3>
                    <div className="space-y-3">
                      {selectedDispute.audit_timeline.map((event, i) => (
                        <div
                          key={event.id || i}
                          className="flex gap-3 text-sm"
                        >
                          <div className="flex flex-col items-center">
                            <div className={cn(
                              "w-2 h-2 rounded-full mt-1.5",
                              event.action_type.includes("APPROVED") ? "bg-emerald-500" :
                              event.action_type.includes("REJECTED") ? "bg-red-500" :
                              event.action_type.includes("ESCALATED") ? "bg-purple-500" :
                              "bg-slate-400"
                            )} />
                            {i < selectedDispute.audit_timeline!.length - 1 && (
                              <div className="w-px h-full bg-slate-200 my-1" />
                            )}
                          </div>
                          <div className="flex-1 pb-3">
                            <p className="font-medium text-slate-700">
                              {event.action_type.replace(/_/g, " ")}
                            </p>
                            <p className="text-slate-500 text-xs">
                              {event.actor_role} • {formatDateTime(event.acted_at)}
                            </p>
                            {event.reason && (
                              <p className="text-slate-600 mt-1">{event.reason}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                {activeQueue !== "my" && !["approved", "rejected"].includes(selectedDispute.status) && (
                  <div className="border-t border-slate-100 pt-4 space-y-2">
                    {activeQueue === "manager" && (
                      <>
                        {!selectedDispute.payroll_impact && !selectedDispute.payroll_head_approval_required && (
                          <Button
                            className="w-full bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => setActionType("approve")}
                          >
                            <Check className="h-4 w-4 mr-2" />
                            Approve
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          className="w-full border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => setActionType("reject")}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => setActionType("escalate_to_hr")}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Escalate to HR
                        </Button>
                      </>
                    )}
                    {activeQueue === "hr" && (
                      <>
                        {!selectedDispute.payroll_impact && !selectedDispute.payroll_head_approval_required && (
                          <Button
                            className="w-full bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => setActionType("approve")}
                          >
                            <Check className="h-4 w-4 mr-2" />
                            Approve
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          className="w-full border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => setActionType("reject")}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Reject
                        </Button>
                        {(selectedDispute.payroll_impact || selectedDispute.payroll_head_approval_required) && (
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => setActionType("escalate_to_payroll")}
                          >
                            <Send className="h-4 w-4 mr-2" />
                            Escalate to Payroll
                          </Button>
                        )}
                      </>
                    )}
                    {activeQueue === "payroll" && (
                      <>
                        <Button
                          className="w-full bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => setActionType("approve")}
                        >
                          <Check className="h-4 w-4 mr-2" />
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => setActionType("reject")}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => setActionType("send_back")}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Send Back to HR
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {detailLoading && (
                <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Action Confirmation Dialog */}
      <Sheet open={!!actionType} onOpenChange={(open) => !open && setActionType(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-lg",
                actionType === "approve" ? "bg-emerald-100" :
                actionType === "reject" ? "bg-red-100" :
                "bg-blue-100"
              )}>
                {actionType === "approve" ? <Check className="h-5 w-5 text-emerald-600" /> :
                 actionType === "reject" ? <XCircle className="h-5 w-5 text-red-600" /> :
                 <Send className="h-5 w-5 text-blue-600" />}
              </div>
              <span>
                {actionType === "approve" && "Approve Dispute"}
                {actionType === "reject" && "Reject Dispute"}
                {actionType === "escalate_to_hr" && "Escalate to HR"}
                {actionType === "escalate_to_payroll" && "Escalate to Payroll"}
                {actionType === "send_back" && "Send Back to HR"}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {selectedDispute && (
              <div className="bg-slate-50 rounded-xl p-4 text-sm">
                <p className="font-medium">{selectedDispute.employee_name}</p>
                <p className="text-slate-500">
                  {selectedDispute.employee_code} • {formatDate(selectedDispute.session_date)}
                </p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                Reason {actionType !== "approve" && <span className="text-red-500">*</span>}
              </label>
              <Textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder={
                  actionType === "approve"
                    ? "Optional reason for approval..."
                    : "Enter reason for this action..."
                }
                rows={4}
                className="resize-none"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setActionType(null);
                  setActionReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                className={cn(
                  "flex-1",
                  actionType === "approve" ? "bg-emerald-600 hover:bg-emerald-700" :
                  actionType === "reject" ? "bg-red-600 hover:bg-red-700" :
                  "bg-blue-600 hover:bg-blue-700"
                )}
                onClick={handleAction}
                disabled={actionInProgress || (actionType !== "approve" && !actionReason.trim())}
              >
                {actionInProgress && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirm
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <DiscardDialog
        open={Boolean(discardDisputeId)}
        onOpenChange={(open) => { if (!open) setDiscardDisputeId(null); }}
        entityType="dispute"
        entityId={discardDisputeId}
        onDiscarded={() => { fetchDisputes(); fetchCounts(); }}
      />
    </DashboardLayout>
  );
}
