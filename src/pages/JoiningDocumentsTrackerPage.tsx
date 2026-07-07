import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileCheck, Users, CheckCircle2, Clock, AlertTriangle, RefreshCw, Search } from "lucide-react";
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
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;

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
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                      >
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
    </DashboardLayout>
  );
}
