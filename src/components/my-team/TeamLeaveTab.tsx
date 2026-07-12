import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, History, ClipboardList, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LeaveRow {
  id: string;
  employee_code: string;
  employee_name: string;
  first_name?: string;
  last_name?: string;
  // Leave dates: API uses from_date / to_date
  from_date: string;
  to_date: string;
  total_days?: number;
  days_count?: number;
  remarks?: string;
  status: string;
  applied_at?: string;
  leave_type_name?: string;
  leave_code?: string;
  department_name?: string;
  branch_name?: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending:   "bg-amber-100 text-amber-800",
  approved:  "bg-emerald-100 text-emerald-800",
  rejected:  "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-100 text-slate-600",
};

function LeaveTypePill({ name }: { name?: string }) {
  if (!name) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
      <Calendar className="h-3 w-3" />{name}
    </span>
  );
}

// ── Avatar initials ───────────────────────────────────────────
function Avatar({ name }: { name: string }) {
  const initials = (name ?? "?").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const hue = (name ?? "").charCodeAt(0) * 7 % 360;
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
      style={{ background: `hsl(${hue},55%,45%)` }}
    >
      {initials}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function TeamLeaveTab() {
  const [showHistory, setShowHistory] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{
    id: string; action: "approved" | "rejected"; name: string;
  } | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const statusFilter = showHistory ? "approved,rejected" : "pending";

  const { data, isLoading } = useQuery({
    queryKey: ["team-leaves", statusFilter],
    queryFn: () => hrmsApi.get<any>(`/api/leave/requests?status=${statusFilter}&limit=200`),
    staleTime: 30_000,
  });

  const rows: LeaveRow[] = (data as any)?.data ?? [];
  const days = (r: LeaveRow) => r.total_days ?? r.days_count ?? "—";

  async function handleReview() {
    if (!reviewTarget) return;
    setSubmitting(true);
    try {
      await hrmsApi.patch(`/api/leave/requests/${reviewTarget.id}/review`, {
        action: reviewTarget.action,
        remarks: remarks.trim() || undefined,
      });
      toast({
        title: reviewTarget.action === "approved" ? "Leave approved" : "Leave rejected",
        description: `${reviewTarget.name}'s request has been ${reviewTarget.action}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["team-leaves"] });
      setReviewTarget(null);
      setRemarks("");
    } catch (err: unknown) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const pendingCount = !showHistory ? rows.length : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">
            {showHistory ? "Leave History" : "Pending Approvals"}
          </h3>
          {pendingCount > 0 && (
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700">
              {pendingCount}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-1.5 text-xs rounded-xl"
          onClick={() => setShowHistory((p) => !p)}
        >
          <History className="h-3.5 w-3.5" />
          {showHistory ? "Show Pending" : "Show History"}
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16">
          <ClipboardList className="h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm font-medium text-slate-500">
            {showHistory ? "No leave history found." : "No pending leave requests."}
          </p>
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="font-semibold text-slate-600">Employee</TableHead>
                <TableHead className="font-semibold text-slate-600">Type</TableHead>
                <TableHead className="font-semibold text-slate-600">From</TableHead>
                <TableHead className="font-semibold text-slate-600">To</TableHead>
                <TableHead className="font-semibold text-slate-600 text-center">Days</TableHead>
                <TableHead className="font-semibold text-slate-600">Reason</TableHead>
                <TableHead className="font-semibold text-slate-600">Status</TableHead>
                {!showHistory && <TableHead className="font-semibold text-slate-600 text-center">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="hover:bg-slate-50/60 transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.employee_name} />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{r.employee_name}</p>
                        <p className="text-xs text-slate-400">{r.employee_code}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><LeaveTypePill name={r.leave_type_name} /></TableCell>
                  <TableCell className="font-mono text-sm text-slate-700">{r.from_date}</TableCell>
                  <TableCell className="font-mono text-sm text-slate-700">{r.to_date}</TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                      {days(r)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[160px]">
                    <p className="truncate text-xs text-slate-500">{r.remarks || "—"}</p>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {r.status}
                    </span>
                  </TableCell>
                  {!showHistory && (
                    <TableCell>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setReviewTarget({ id: r.id, action: "approved", name: r.employee_name })}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setReviewTarget({ id: r.id, action: "rejected", name: r.employee_name })}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" />Reject
                        </button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Review dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={(o) => { if (!o) { setReviewTarget(null); setRemarks(""); } }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {reviewTarget?.action === "approved"
                ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                : <XCircle className="h-5 w-5 text-rose-600" />}
              {reviewTarget?.action === "approved" ? "Approve" : "Reject"} Leave
            </DialogTitle>
            <p className="text-sm text-slate-500">{reviewTarget?.name}</p>
          </DialogHeader>
          <Textarea
            placeholder="Add remarks (optional)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="rounded-xl resize-none"
          />
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => { setReviewTarget(null); setRemarks(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleReview}
              disabled={submitting}
              className={`rounded-xl ${reviewTarget?.action === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
            >
              {submitting ? "Submitting…" : reviewTarget?.action === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
