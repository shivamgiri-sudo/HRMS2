import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileCheck, Users, CheckCircle2, Clock, CircleDashed, AlertTriangle, RefreshCw, Search, ListChecks, Bell, FilePlus, UserPlus, Calendar, Download, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsBentoTile } from "@/components/ui/hrms-modern";
import { OnboardingTabBar } from "@/components/onboarding/OnboardingTabBar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import { classifyEmployeeBucket, type SummaryBucket } from "@/lib/trackerSummaryBucket";

interface EmployeeRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_name: string | null;
  process_name: string | null;
  date_of_joining: string;
  // The two milestones that sit either side of the joining date. Null means the
  // step has not happened — the candidate has not submitted the onboarding form,
  // or no salary has been assigned yet — and the column renders a dash for it
  // rather than an empty cell that reads as a rendering bug.
  onboarding_submitted_at: string | null;
  salary_assigned_at: string | null;
  // `joining_document_status` is deliberately absent. The service still sends the
  // column, but nothing here reads it: the row badge is derived from
  // `joining_document_completion_pct` through the same classifier the tiles use,
  // so the badge cannot disagree with the tile above it (Requirement 7,
  // criterion 4). Declaring a field the page does not read is what let the two
  // drift apart in the first place.
  joining_document_completion_pct: number;
  total_documents: number;
  verified_count: number;
  needs_correction_count: number;
  overdue_count: number;
  // Null, not 0, when the employee has no checklist rows in the eSign
  // denominator — "nothing to sign" is not "everything signed" (Requirement 8).
  // Nullability here mirrors `EmployeeDocumentRow` in the service.
  esign_completed_count: number | null;
  esign_pending_count: number | null;
  updated_at: string;
}

/**
 * Mirrors `TrackerSummary` in
 * `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts`, restricted to
 * the fields this page renders.
 *
 * `completed_count`, `in_progress_count` and `pending_count` are a partition of
 * the employee set and sum to `total_employees`; `overdue_count` is a
 * cross-cutting count that sits outside that sum. `pending_verification` is gone
 * — it was a fourth bucket for the 75-99% band that no tile rendered, and it is
 * now folded into `in_progress` by the classifier.
 */
interface TrackerSummary {
  total_employees: number;
  completed_count: number;
  in_progress_count: number;
  pending_count: number;
  overdue_count: number;
}

interface TrackerResponse {
  success: boolean;
  data: {
    rows: EmployeeRow[];
    total: number;
    summary: TrackerSummary;
  };
}

/**
 * The row badge. Three variants, one per summary bucket, so every bucket the
 * tiles count has a badge and vice versa.
 *
 * It reads the completion percentage and classifies it here rather than reading
 * the `joining_document_status` column, which is written by
 * `recalculateDocumentProgress` on its own schedule and can therefore contradict
 * the tiles.
 */
function StatusBadge({ pct }: { pct: number }) {
  const variants: Record<SummaryBucket, { label: string; cls: string }> = {
    completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    in_progress: { label: "In Progress", cls: "bg-amber-100 text-amber-800 border-amber-300" },
    pending: { label: "Pending", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  };
  const v = variants[classifyEmployeeBucket(pct)];
  return <Badge variant="outline" className={v.cls}>{v.label}</Badge>;
}

/**
 * One process-milestone date.
 *
 * A dash, not a blank cell, when the step has not happened: an empty cell in a
 * table of dates reads as data that failed to load, which is the opposite of
 * what a missing onboarding submission or an unassigned salary means.
 * formatISTDate renders in Asia/Kolkata, so a timestamp stored at IST midnight
 * does not display as the previous day.
 */
function MilestoneDateCell({ value }: { value: string | null }) {
  return (
    <td className="px-4 py-3 text-sm whitespace-nowrap">
      {value
        ? <span className="text-slate-600">{formatISTDate(value)}</span>
        : <span className="text-slate-300">—</span>}
    </td>
  );
}

export default function JoiningDocumentsTrackerPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  // What the query actually runs on. The box used to be the query key directly,
  // so every keystroke fired a fresh request — seven of them for "ravikar", each
  // one a pair of aggregate queries, and with keepPreviousData holding the old
  // rows on screen the page looked like it was ignoring the search entirely.
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;

  // Bulk action state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [remindModalOpen, setRemindModalOpen] = useState(false);
  const [assignHrModalOpen, setAssignHrModalOpen] = useState(false);
  const [dueDateModalOpen, setDueDateModalOpen] = useState(false);
  const [confirmVerifyOpen, setConfirmVerifyOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedHrUserId, setAssignedHrUserId] = useState("");

  // Debounced rather than searched-on-submit: the box should feel live, and 300ms
  // is long enough that a typed word is one request instead of seven.
  useEffect(() => {
    const t = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<TrackerResponse>({
    // An object, not positional members. A filter added later becomes a new named
    // key on this object, so it cannot silently occupy a position that already
    // meant something else — the failure mode of a positional key, where two
    // different filter states hash to the same entry and the cache serves the
    // wrong page.
    queryKey: ["joining-documents-tracker", { search: appliedSearch, statusFilter, overdueOnly, page, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (appliedSearch) params.set("search", appliedSearch);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (overdueOnly) params.set("overdue_only", "true");
      params.set("page", String(page));
      params.set("limit", String(limit));
      return await hrmsApi.get(`/api/ats/joining-documents-tracker?${params.toString()}`);
    },
    // A worker completion is written without the page knowing, so the page has to
    // ask. Sixty seconds against the worker's five-minute tick means a completion
    // surfaces within a minute of being written (Requirement 10, criterion 2).
    refetchInterval: 60_000,
    // A background tab stops polling. Each refetch is two aggregate queries over
    // the whole filtered set; a forgotten tab must not keep paying for them.
    refetchIntervalInBackground: false,
    // Keep the previous rows on screen through a page change or an interval
    // refetch instead of dropping to the skeleton (Requirement 10, criterion 4).
    // v5 form: the boolean `keepPreviousData` option was removed in favour of
    // this sentinel.
    placeholderData: keepPreviousData,
  });

  const summary: TrackerSummary = data?.data?.summary ?? {
    total_employees: 0,
    completed_count: 0,
    in_progress_count: 0,
    pending_count: 0,
    overdue_count: 0,
  };

  const rows = data?.data?.rows ?? [];
  const total = data?.data?.total ?? 0;

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  const hasNext = end < total;
  const hasPrev = page > 1;

  // Bulk action mutations
  const bulkRemindMutation = useMutation({
    mutationFn: (data: { employee_ids: string[]; custom_message?: string }) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/bulk-remind", data),
    onSuccess: (res: any) => {
      toast({ title: `Reminders sent to ${res.data?.sent_count ?? selectedIds.size} employees` });
      setSelectedIds(new Set());
      setRemindModalOpen(false);
      setCustomMessage("");
      // Prefix invalidation, not the local `refetch()`: it refreshes every cached
      // page of the tracker rather than only the visible one, so the tiles (which
      // describe the whole filtered set) and the list both re-read
      // (Requirement 10, criterion 1).
      queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] });
    },
    onError: (err: any) => toast({ title: "Failed to send reminders", description: err?.message, variant: "destructive" }),
  });

  const bulkGenerateMutation = useMutation({
    mutationFn: (data: { employee_ids: string[] }) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/bulk-generate-checklist", data),
    onSuccess: (res: any) => {
      toast({ title: `Checklists generated for ${res.data?.generated_count ?? selectedIds.size} employees` });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] });
    },
    onError: (err: any) => toast({ title: "Failed to generate checklists", description: err?.message, variant: "destructive" }),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: (data: { employee_ids: string[]; assigned_hr_user_id: string }) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/bulk-assign", data),
    onSuccess: (res: any) => {
      toast({ title: `HR assigned to ${res.data?.assigned_count ?? selectedIds.size} employees` });
      setSelectedIds(new Set());
      setAssignHrModalOpen(false);
      setAssignedHrUserId("");
      queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] });
    },
    onError: (err: any) => toast({ title: "Failed to assign HR", description: err?.message, variant: "destructive" }),
  });

  const { data: hrUsersData } = useQuery({
    queryKey: ['hr-users-for-assign'],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; employee_code: string; first_name: string; last_name: string }> }>('/api/employees?role=hr&limit=50'),
    staleTime: 60_000,
  });
  const hrUsers = (hrUsersData as any)?.data ?? [];

  const bulkDueDateMutation = useMutation({
    mutationFn: (data: { employee_ids: string[]; due_date: string }) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/bulk-set-due-date", data),
    onSuccess: (res: any) => {
      toast({ title: `Due date set for ${res.data?.updated_count ?? selectedIds.size} employees` });
      setSelectedIds(new Set());
      setDueDateModalOpen(false);
      setDueDate("");
      queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] });
    },
    onError: (err: any) => toast({ title: "Failed to set due date", description: err?.message, variant: "destructive" }),
  });

  const bulkVerifyMutation = useMutation({
    mutationFn: (data: { employee_ids: string[] }) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/bulk-verify", data),
    onSuccess: (res: any) => {
      toast({ title: `Documents verified for ${res.data?.verified_count ?? selectedIds.size} employees` });
      setSelectedIds(new Set());
      setConfirmVerifyOpen(false);
      queryClient.invalidateQueries({ queryKey: ["joining-documents-tracker"] });
    },
    onError: (err: any) => toast({ title: "Failed to verify documents", description: err?.message, variant: "destructive" }),
  });

  const resendNotificationMutation = useMutation({
    mutationFn: (employee_id: string) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/resend-notification", { employee_id }),
    onSuccess: (res: any) => {
      toast({ title: res.data?.message ?? "Notification resent to Payroll HR" });
    },
    onError: (err: any) => toast({ title: "Failed to resend notification", description: err?.response?.data?.message ?? err?.message, variant: "destructive" }),
  });

  const handleBulkDownload = async () => {
    try {
      const token = getAuthToken();
      const response = await fetch("/api/ats/joining-documents-tracker/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ employee_ids: Array.from(selectedIds) }),
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `joining-documents-${new Date().toISOString().split("T")[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started" });
      setSelectedIds(new Set());
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message, variant: "destructive" });
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === rows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map(r => r.employee_id)));
  };

  return (
    <DashboardLayout>
      <div>
        {/* Gradient header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-600 text-white p-6 mb-5 shadow-lg">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-200">HR · Document Management</p>
              <h1 className="mt-1 text-2xl font-bold text-white">Joining Documents Tracker</h1>
              <p className="mt-1 text-sm text-blue-100">Monitor joining document completion, e-sign status, and verification progress across all employees.</p>
            </div>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2 min-h-[44px] border-white/30 bg-white/10 text-white hover:bg-white/20"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
        <OnboardingTabBar />

        {/*
          Five tiles, not four. Completed + In Progress + Pending is a partition of
          the employee set and sums to Total Employees; Overdue is cross-cutting and
          sits outside that sum. Pending earns a tile because Completed + In Progress
          cannot reach the total while any employee sits at 0% (Requirement 7,
          criterion 3).
        */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <HrmsBentoTile
            icon={<Users className="h-5 w-5" />}
            title="Total Employees"
            value={summary.total_employees}
            className="bg-slate-50 text-slate-700"
          />
          <HrmsBentoTile
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Completed"
            value={summary.completed_count}
            className="bg-emerald-50 text-emerald-700"
          />
          <HrmsBentoTile
            icon={<Clock className="h-5 w-5" />}
            title="In Progress"
            value={summary.in_progress_count}
            className="bg-amber-50 text-amber-700"
          />
          <HrmsBentoTile
            icon={<CircleDashed className="h-5 w-5" />}
            title="Pending"
            value={summary.pending_count}
            className="bg-slate-50 text-slate-600"
          />
          <HrmsBentoTile
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Overdue"
            value={summary.overdue_count}
            className="bg-rose-50 text-rose-700"
          />
        </div>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by name or code..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10 min-h-[44px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[180px] min-h-[44px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="overdue"
                  checked={overdueOnly}
                  onCheckedChange={checked => { setOverdueOnly(!!checked); setPage(1); }}
                />
                <Label htmlFor="overdue" className="cursor-pointer text-sm font-medium">
                  Overdue only
                </Label>
              </div>
              {/* Bulk Actions Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={selectedIds.size === 0} className="gap-2 min-h-[44px]">
                    <ListChecks className="h-4 w-4" />
                    Bulk Actions ({selectedIds.size})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setRemindModalOpen(true)}>
                    <Bell className="h-4 w-4 mr-2" /> Send Reminders
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => bulkGenerateMutation.mutate({ employee_ids: Array.from(selectedIds) })}>
                    <FilePlus className="h-4 w-4 mr-2" /> Generate Checklists
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAssignHrModalOpen(true)}>
                    <UserPlus className="h-4 w-4 mr-2" /> Assign HR
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDueDateModalOpen(true)}>
                    <Calendar className="h-4 w-4 mr-2" /> Set Due Date
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setConfirmVerifyOpen(true)} className="text-emerald-600">
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Verify All Documents
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleBulkDownload}>
                    <Download className="h-4 w-4 mr-2" /> Download ZIP
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : isError ? (
              <div className="py-16 text-center">
                <AlertTriangle className="mx-auto h-12 w-12 text-destructive/70" />
                <p className="mt-4 text-base font-medium text-slate-700">Couldn't load joining documents</p>
                <p className="mt-1 text-sm text-slate-500">
                  {(error as Error)?.message || "The server returned an error. This is not the same as no data existing."}
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Retry
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center">
                <FileCheck className="mx-auto h-12 w-12 text-slate-300" />
                <p className="mt-4 text-base font-medium text-slate-600">No employees found</p>
                <p className="mt-1 text-sm text-slate-500">
                  {search || statusFilter !== "all" || overdueOnly
                    ? "Try adjusting your filters"
                    : "No joining documents to track yet"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                      <th className="px-2 py-3 w-10">
                        <Checkbox
                          checked={selectedIds.size === rows.length && rows.length > 0}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Branch</th>
                      <th className="px-4 py-3">Process</th>
                      <th className="px-4 py-3 whitespace-nowrap">Onboarding</th>
                      <th className="px-4 py-3 whitespace-nowrap">Joining</th>
                      <th className="px-4 py-3 whitespace-nowrap">Salary</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Completion</th>
                      <th className="px-4 py-3">Documents</th>
                      <th className="px-4 py-3">E-Sign</th>
                      <th className="px-4 py-3">Overdue</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(row => (
                      <tr
                        key={row.employee_id}
                        onClick={() => navigate(`/employees/${row.employee_id}/joining-documents`)}
                        className={`cursor-pointer transition-colors hover:bg-slate-50 ${selectedIds.has(row.employee_id) ? "bg-blue-50" : ""}`}
                      >
                        <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(row.employee_id)}
                            onCheckedChange={() => toggleSelect(row.employee_id)}
                            aria-label={`Select ${row.full_name}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{row.full_name}</p>
                          <p className="font-mono text-xs text-slate-500">{row.employee_code}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{row.branch_name || "-"}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{row.process_name || "-"}</td>
                        <MilestoneDateCell value={row.onboarding_submitted_at} />
                        <MilestoneDateCell value={row.date_of_joining} />
                        <MilestoneDateCell value={row.salary_assigned_at} />
                        <td className="px-4 py-3">
                          <StatusBadge pct={row.joining_document_completion_pct} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Progress value={row.joining_document_completion_pct} className="w-24 h-2" />
                            <span className="text-xs font-medium text-slate-600">{row.joining_document_completion_pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {row.verified_count}/{row.total_documents}
                        </td>
                        <td className="px-4 py-3">
                          {row.esign_completed_count !== null && row.esign_pending_count !== null ? (
                            <Badge
                              variant="outline"
                              className={
                                row.esign_pending_count === 0
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                  : "bg-amber-100 text-amber-800 border-amber-300"
                              }
                            >
                              {row.esign_completed_count}/{row.esign_completed_count + row.esign_pending_count}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.overdue_count > 0 ? (
                            <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300">
                              {row.overdue_count}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" className="min-h-[36px]" onClick={e => e.stopPropagation()}>
                                Actions
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/employees/${row.employee_id}/joining-documents`)}>
                                View Documents
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={e => {
                                  e.stopPropagation();
                                  resendNotificationMutation.mutate(row.employee_id);
                                }}
                              >
                                <Bell className="h-3.5 w-3.5 mr-2" />
                                Resend Payroll HR Notification
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!isLoading && rows.length > 0 && (
              <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                <p className="text-sm text-slate-600">
                  Showing {start} to {end} of {total} employees
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(p => p - 1)}
                    disabled={!hasPrev}
                    className="min-h-[36px]"
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(p => p + 1)}
                    disabled={!hasNext}
                    className="min-h-[36px]"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Send Reminders Modal */}
      <Dialog open={remindModalOpen} onOpenChange={setRemindModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Reminders</DialogTitle>
            <DialogDescription>
              Send reminder notifications to {selectedIds.size} selected employee(s) about pending joining documents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="customMessage">Custom Message (optional)</Label>
              <Textarea
                id="customMessage"
                placeholder="Enter a custom message to include in the reminder..."
                value={customMessage}
                onChange={e => setCustomMessage(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemindModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulkRemindMutation.mutate({ employee_ids: Array.from(selectedIds), custom_message: customMessage || undefined })}
              disabled={bulkRemindMutation.isPending}
            >
              {bulkRemindMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bell className="h-4 w-4 mr-2" />}
              Send Reminders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign HR Modal */}
      <Dialog open={assignHrModalOpen} onOpenChange={setAssignHrModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign HR</DialogTitle>
            <DialogDescription>
              Assign an HR user to manage joining documents for {selectedIds.size} selected employee(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="hrUserId">Assign HR User</Label>
              <select
                id="hrUserId"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={assignedHrUserId}
                onChange={e => setAssignedHrUserId(e.target.value)}
              >
                <option value="">— Select HR —</option>
                {hrUsers.map((u: { id: string; employee_code: string; first_name: string; last_name: string }) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name} ({u.employee_code})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignHrModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulkAssignMutation.mutate({ employee_ids: Array.from(selectedIds), assigned_hr_user_id: assignedHrUserId })}
              disabled={bulkAssignMutation.isPending || !assignedHrUserId}
            >
              {bulkAssignMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
              Assign HR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Due Date Modal */}
      <Dialog open={dueDateModalOpen} onOpenChange={setDueDateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Due Date</DialogTitle>
            <DialogDescription>
              Set a due date for joining documents for {selectedIds.size} selected employee(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="dueDate">Due Date</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDueDateModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulkDueDateMutation.mutate({ employee_ids: Array.from(selectedIds), due_date: dueDate })}
              disabled={bulkDueDateMutation.isPending || !dueDate}
            >
              {bulkDueDateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calendar className="h-4 w-4 mr-2" />}
              Set Due Date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Verify Modal */}
      <Dialog open={confirmVerifyOpen} onOpenChange={setConfirmVerifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify All Documents</DialogTitle>
            <DialogDescription>
              This will mark all pending documents as verified for {selectedIds.size} selected employee(s).
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVerifyOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulkVerifyMutation.mutate({ employee_ids: Array.from(selectedIds) })}
              disabled={bulkVerifyMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {bulkVerifyMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Verify All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
