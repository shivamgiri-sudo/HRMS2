import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Paperclip, RefreshCw, ShieldCheck } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CLEARANCE_STATUS_COLORS, CLEARANCE_STATUS_LABELS,
  NOC_STATUS_COLORS, NOC_STATUS_LABELS,
  type ClearanceOwnerRole, type ExitClearanceTaskRow,
} from "@/lib/exitClearance";

const fmtDate = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

interface Props {
  /** Restricts the queue to one owner_role's tasks. Omitted = backend defaults to the caller's own role(s). */
  ownerRole?: ClearanceOwnerRole;
  /** Drops the page-level card header/description — used when embedded inside another page's own layout. */
  embedded?: boolean;
  title?: string;
  description?: string;
  /** Opens the full drill-down drawer for the given exit request id. */
  onRowClick?: (exitRequestId: string) => void;
}

export function ExitClearanceQueue({ ownerRole, embedded, title, description, onRowClick }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("open");

  const statusParam = statusFilter === "open" ? "pending,in_progress,blocked" : statusFilter;

  const queryKey = ["exit-clearance-queue", ownerRole, statusParam];
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ownerRole) params.set("owner_role", ownerRole);
      if (statusParam !== "all") params.set("status", statusParam);
      const qs = params.toString();
      const res = await hrmsApi.get<{ success: boolean; data: ExitClearanceTaskRow[]; pagination: { total: number } }>(
        `/api/exit/clearance/queue${qs ? `?${qs}` : ""}`,
      );
      return res;
    },
  });

  const rows = data?.data ?? [];
  const total = data?.pagination?.total ?? rows.length;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["exit-clearance-queue"] });
    queryClient.invalidateQueries({ queryKey: ["exit-command-center"] });
  };

  const clearanceMutation = useMutation({
    mutationFn: ({ task, status, remarks }: { task: ExitClearanceTaskRow; status: "cleared" | "waived"; remarks: string }) =>
      hrmsApi.patch(`/api/exit/${task.exit_request_id}/clearance/${task.id}`, { status, remarks }),
    onSuccess: (_res, variables) => {
      toast({ title: variables.status === "cleared" ? "Task cleared" : "Task waived" });
      invalidateAll();
    },
    onError: (err: any) => {
      toast({ title: "Could not update task", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const handleAction = (task: ExitClearanceTaskRow, status: "cleared" | "waived") => {
    const remarks = window.prompt(status === "cleared" ? "Remarks for clearing this task:" : "Reason for waiving this task:");
    if (remarks === null) return; // cancelled
    clearanceMutation.mutate({ task, status, remarks });
  };

  const body = (
    <>
      {isError && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-rose-700">{(error as any)?.message ?? "Failed to load clearance tasks"}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2 min-h-[44px]">
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" /> Retry
            </Button>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[
          { key: "open", label: "Open" },
          { key: "all", label: "All" },
          { key: "cleared", label: "Cleared" },
          { key: "waived", label: "Waived" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              statusFilter === f.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f.label}
          </button>
        ))}
        {isFetching && !isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden="true" />}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading exit clearance tasks">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <ShieldCheck className="mb-3 h-10 w-10 text-slate-300" aria-hidden="true" />
          <h3 className="text-base font-bold text-slate-700">No clearance tasks in your queue</h3>
          <p className="mt-1 text-sm text-slate-500">Tasks appear here once an employee's Last Working Day arrives</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead>Employee</TableHead>
                <TableHead>Branch / Process</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>NOC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((task) => (
                <TableRow
                  key={task.id}
                  className="cursor-pointer hover:bg-blue-50/40"
                  onClick={() => onRowClick?.(task.exit_request_id)}
                >
                  <TableCell>
                    <p className="font-medium">{task.employee_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{task.employee_code}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {task.branch_name ?? "—"}{task.process_name ? ` · ${task.process_name}` : ""}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-semibold text-slate-700">{task.task_title}</p>
                    <p className="text-xs capitalize text-slate-400">{task.clearance_area.replace(/_/g, " ")}</p>
                    {task.remarks && <p className="mt-0.5 text-xs text-slate-500">{task.remarks}</p>}
                    {task.attachment_url && (
                      <a
                        href={task.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        <Paperclip className="h-3 w-3" />Attachment
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(task.due_date)}</TableCell>
                  <TableCell>
                    {task.noc_case_status ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${NOC_STATUS_COLORS[task.noc_case_status] ?? "bg-slate-100 text-slate-600"}`}>
                        {NOC_STATUS_LABELS[task.noc_case_status] ?? task.noc_case_status}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${CLEARANCE_STATUS_COLORS[task.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {CLEARANCE_STATUS_LABELS[task.status] ?? task.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {["pending", "in_progress", "blocked"].includes(task.status) && (
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => handleAction(task, "cleared")}
                          disabled={clearanceMutation.isPending}
                          className="cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => handleAction(task, "waived")}
                          disabled={clearanceMutation.isPending}
                          className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Waive
                        </button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div>{body}</div>;
  }

  return (
    <Card className="rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">
          {title ?? "Exit Clearance Tasks"}
          {total > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({total} total)</span>}
        </CardTitle>
        <CardDescription>{description ?? "Click an employee row to view the full exit record. Clear or waive a task directly from this list."}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
