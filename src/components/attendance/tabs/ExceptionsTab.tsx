/**
 * Attendance exceptions for one employee.
 *
 * These are the reconciliation issues the nightly worker raises — a punch the biometric
 * device never recorded, minutes that disagree with the dialler, payable days that do not
 * match what salary was calculated on. They are the reason an attendance day is wrong, so
 * they belong next to the day itself rather than only on a separate console.
 *
 * Resolving one does NOT correct the attendance: the correction goes through the Attendance
 * tab's Change status (or a regularization). Closing an exception only records that a human
 * has dealt with it, with their reason — deliberately separate audit trails.
 */

import { useMemo, useState } from "react";
import { format, startOfMonth, subMonths } from "date-fns";
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  EXCEPTION_TYPE_LABELS, MIN_CORRECTION_REASON, useCanCorrectAttendance,
  useEmployeeExceptions, useResolveException, type AttendanceExceptionRow,
} from "@/hooks/useAttendanceCorrections";

interface Props { employeeId: string; }

type StatusFilter = "open" | "resolved" | "all";

/** How far back to look. The endpoint defaults to 30 days, which hides last quarter. */
const RANGE_OPTIONS = [
  { value: "3",  label: "Last 3 months" },
  { value: "6",  label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
];

export function ExceptionsTab({ employeeId }: Props) {
  const { toast } = useToast();
  const { canCorrect } = useCanCorrectAttendance();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [months, setMonths] = useState("3");
  const [target, setTarget] = useState<{ row: AttendanceExceptionRow; reopen: boolean } | null>(null);
  const [reason, setReason] = useState("");

  const fromDate = useMemo(
    () => format(startOfMonth(subMonths(new Date(), Number(months))), "yyyy-MM-dd"),
    [months],
  );

  const { data: rows = [], isLoading } = useEmployeeExceptions(employeeId, { fromDate, status });
  const resolve = useResolveException();

  const reasonOk = reason.trim().length >= MIN_CORRECTION_REASON;

  async function handleConfirm() {
    if (!target || !reasonOk) return;
    try {
      await resolve.mutateAsync({ id: target.row.id, reason: reason.trim(), reopen: target.reopen });
      toast({
        title: target.reopen ? "Exception reopened" : "Exception resolved",
        description: `${EXCEPTION_TYPE_LABELS[target.row.issue_type] ?? target.row.issue_type} — ${target.row.issue_date?.slice(0, 10)}`,
      });
      setTarget(null);
      setReason("");
    } catch (err: any) {
      toast({
        title: target.reopen ? "Could not reopen" : "Could not resolve",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
          Attendance Exceptions
        </p>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={months} onValueChange={setMonths}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
          No {status === "all" ? "" : status} exceptions in this period.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Issue</th>
                <th className="px-4 py-3 text-left">Severity</th>
                <th className="px-4 py-3 text-left">Day status</th>
                <th className="px-4 py-3 text-left">Minutes</th>
                <th className="px-4 py-3 text-left">State</th>
                {canCorrect && <th className="px-4 py-3 text-right">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const resolved = Boolean(r.resolved_at);
                return (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.issue_date?.slice(0, 10)}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">
                      {EXCEPTION_TYPE_LABELS[r.issue_type] ?? r.issue_type.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant="outline"
                        className={r.severity === "blocker"
                          ? "border-rose-200 bg-rose-50 text-[10px] text-rose-700"
                          : "border-amber-200 bg-amber-50 text-[10px] text-amber-800"}
                      >
                        {r.severity}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs capitalize text-slate-600">
                      {(r.adr_status ?? "—").replace(/_/g, " ")}
                    </td>
                    {/* Source vs HRMS minutes is the whole story for a mismatch row, and
                        meaningless for the rest — show a dash rather than two zeros. */}
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                      {r.source_minutes === null && r.hrms_minutes === null
                        ? "—"
                        : `${r.source_minutes ?? "—"} / ${r.hrms_minutes ?? "—"}`}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        resolved ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"}`}>
                        {resolved ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {resolved ? "Resolved" : "Open"}
                      </span>
                    </td>
                    {canCorrect && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                          onClick={() => { setTarget({ row: r, reopen: resolved }); setReason(""); }}
                        >
                          {resolved ? <RotateCcw className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                          {resolved ? "Reopen" : "Resolve"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) { setTarget(null); setReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{target?.reopen ? "Reopen exception" : "Resolve exception"}</DialogTitle>
            <DialogDescription>
              {target ? `${EXCEPTION_TYPE_LABELS[target.row.issue_type] ?? target.row.issue_type} — ${target.row.issue_date?.slice(0, 10)}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {target?.reopen
                ? "Reopening puts this exception back on the worklist."
                : "Resolving records that this has been dealt with. It does not change the attendance day itself — use Change status on the Attendance tab for that."}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="exception-reason" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Reason <span className="font-normal normal-case text-slate-400">(minimum {MIN_CORRECTION_REASON} characters)</span>
              </Label>
              <Textarea
                id="exception-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Punch verified against the branch register; attendance corrected on 12 Aug."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setTarget(null); setReason(""); }} disabled={resolve.isPending}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={!reasonOk || resolve.isPending}>
              {resolve.isPending ? "Saving…" : target?.reopen ? "Reopen" : "Resolve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
