import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileCheck, Users, CheckCircle2, Clock, AlertTriangle, RefreshCw, Search, ListChecks, Bell, FilePlus, UserPlus, Calendar, Download, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsModernShell, HrmsBentoTile } from "@/components/ui/hrms-modern";
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
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface EmployeeRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_name: string | null;
  process_name: string | null;
  date_of_joining: string;
  joining_document_status: "pending" | "in_progress" | "completed";
  joining_document_completion_pct: number;
  total_documents: number;
  verified_count: number;
  needs_correction_count: number;
  overdue_count: number;
  esign_completed_count: number | null;
  esign_pending_count: number | null;
  updated_at: string;
}

interface TrackerResponse {
  success: boolean;
  data: {
    rows: EmployeeRow[];
    total: number;
    summary: {
      total_employees: number;
      completed_count: number;
      in_progress_count: number;
      pending_count: number;
      overdue_count: number;
    };
  };
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; cls: string }> = {
    completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    in_progress: { label: "In Progress", cls: "bg-amber-100 text-amber-800 border-amber-300" },
    pending: { label: "Pending", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  };
  const v = variants[status] ?? variants.pending;
  return <Badge variant="outline" className={v.cls}>{v.label}</Badge>;
}

export default function JoiningDocumentsTrackerPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
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

  const { data, isLoading, refetch, isFetching } = useQuery<TrackerResponse>({
    queryKey: ["joining-documents-tracker", search, statusFilter, overdueOnly, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (overdueOnly) params.set("overdue_only", "true");
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await hrmsApi.get(`/api/ats/joining-documents-tracker?${params.toString()}`);
      return res.data;
    },
  });

  const summary = data?.data?.summary ?? {
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

  // Reset selection when data changes
  const rowIds = useMemo(() => new Set(rows.map(r => r.employee_id)), [rows]);

  // Bulk action mutations
  const bulkRemindMutation = useMutation({
    mutationFn: (data: { employee_ids: string[]; custom_message?: string }) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/bulk-remind", data),
    onSuccess: (res: any) => {
      toast({ title: `Reminders sent to ${res.data?.sent_count ?? selectedIds.size} employees` });
      setSelectedIds(new Set());
      setRemindModalOpen(false);
      setCustomMessage("");
      refetch();
    },
    onError: (err: any) => toast({ title: "Failed to send reminders", description: err?.message, variant: "destructive" }),
  });

  const bulkGenerateMutation = useMutation({
    mutationFn: (data: { employee_ids: string[] }) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/bulk-generate-checklist", data),
    onSuccess: (res: any) => {
      toast({ title: `Checklists generated for ${res.data?.generated_count ?? selectedIds.size} employees` });
      setSelectedIds(new Set());
      refetch();
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
      refetch();
    },
    onError: (err: any) => toast({ title: "Failed to assign HR", description: err?.message, variant: "destructive" }),
  });

  const bulkDueDateMutation = useMutation({
    mutationFn: (data: { employee_ids: string[]; due_date: string }) =>
      hrmsApi.post("/api/ats/joining-documents-tracker/bulk-set-due-date", data),
    onSuccess: (res: any) => {
      toast({ title: `Due date set for ${res.data?.updated_count ?? selectedIds.size} employees` });
      setSelectedIds(new Set());
      setDueDateModalOpen(false);
      setDueDate("");
      refetch();
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
      refetch();
    },
    onError: (err: any) => toast({ title: "Failed to verify documents", description: err?.message, variant: "destructive" }),
  });

  const handleBulkDownload = async () => {
    try {
      const token = getAccessToken?.();
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
      <HrmsModernShell
        eyebrow="Document Management"
        title="Joining Documents Tracker"
        description="Monitor joining document completion, e-sign status, and verification progress across all employees."
        icon={<FileCheck className="h-6 w-6" />}
        actions={
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2 min-h-[44px]"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <HrmsBentoTile
            icon={<Users className="h-5 w-5" />}
            label="Total Employees"
            value={summary.total_employees}
            className="bg-slate-50 text-slate-700"
          />
          <HrmsBentoTile
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="Completed"
            value={summary.completed_count}
            className="bg-emerald-50 text-emerald-700"
          />
          <HrmsBentoTile
            icon={<Clock className="h-5 w-5" />}
            label="In Progress"
            value={summary.in_progress_count}
            className="bg-amber-50 text-amber-700"
          />
          <HrmsBentoTile
            icon={<AlertTriangle className="h-5 w-5" />}
            label="Overdue"
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
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
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
                        <td className="px-4 py-3">
                          <StatusBadge status={row.joining_document_status} />
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={e => {
                              e.stopPropagation();
                              navigate(`/employees/${row.employee_id}/joining-documents`);
                            }}
                            className="min-h-[36px]"
                          >
                            View
                          </Button>
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
      </HrmsModernShell>

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
              <Label htmlFor="hrUserId">HR User ID</Label>
              <Input
                id="hrUserId"
                placeholder="Enter HR user ID..."
                value={assignedHrUserId}
                onChange={e => setAssignedHrUserId(e.target.value)}
                className="mt-1"
              />
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
